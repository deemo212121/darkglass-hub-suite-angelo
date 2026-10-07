/**
 * Announcements Page — Supabase backed.
 *
 * Reads the company's #announcements channel from the messaging tables, lets
 * higher-up roles post new ones, and tracks per-user read state via the
 * message_reads table (so "unread" counts persist across devices).
 *
 * Every new announcement has a title (announcement_titles, migration 0359 —
 * its own table so chat queries are untouched; older posts simply have
 * none). Posters can pin any announcement to the ticker — the scrolling line
 * under the app header (AnnouncementMarquee) — which shows its title, with
 * an optional end date, and take it down again.
 */

import { useEffect, useMemo, useState } from "react";
import { CheckCheck, Megaphone, Pause, Play, Radio, Search, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { canManageChannelsRole } from "@/lib/roleLabels";
import {
  type ChannelRow,
  type MessageRow,
  getAnnouncementsChannel,
  getChannelMessages,
  markThreadRead,
  sendMessage as sendMessageRow,
  subscribeToMessages,
} from "@/lib/supabase/messaging";
import { getMyProfileId } from "@/lib/supabase/users";
import {
  addMarquee,
  getAnnouncementTitles,
  getTickerEnabled,
  getTickerItems,
  removeMarquee,
  setAnnouncementTitle,
  setMarqueeActive,
  setTickerEnabled,
  tickerTextFrom,
  MARQUEE_CHANGED_EVENT,
  type MarqueeItem,
} from "@/lib/supabase/announcementMarquee";
import { AppModal } from "@/components/ui-kit/AppModal";
import { EmptyState } from "@/components/ui-kit/EmptyState";
import {
  sampleAnnouncements,
  sampleTickerAll,
  sampleTickerEnabled,
  sampleTitles,
  setSampleActive,
  setSampleTickerEnabled,
  isSampleId,
  SAMPLES_ENABLED,
} from "@/lib/announcementSamples";

interface Props {
  mod?: ModuleDef;
  sub?: SubModuleDef;
}

const HIGHER_UP_HINT = "Only HR, managers, admins, and supervisors can post announcements.";

const HIGHER_UP_ROLES = new Set([
  "SUPERADMIN",
  "ADMIN",
  "MANAGER",
  "SENIOR_MANAGER",
  "HR",
  "BRANCH_MANAGER",
  "SENIOR_BRANCH_MANAGER",
  "CSR_MANAGER",
  "CLAIMS_MANAGER",
  "PARTS_MANAGER",
  "BIZOPS_MANAGER",
  "BIZOPS_SENIOR_MANAGER",
]);

const TITLE_MAX = 120;

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

/** "2h ago", "3d ago", or the date for anything older than a week. */
function relativeTime(value: string): string {
  const ms = Date.now() - new Date(value).getTime();
  if (Number.isNaN(ms)) return value;
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function initials(name: string | null): string {
  const parts = (name || "?").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Body text as paragraphs: blank lines split paragraphs, single line breaks are kept inside one. */
function Paragraphs({ text }: { text: string }) {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className="ann-body">
      {paras.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

/** Date input value (YYYY-MM-DD) → end of that day, as an ISO timestamp. */
function endOfDayISO(date: string): string | null {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59).toISOString();
}

type Filter = "all" | "unread" | "internal";

export function AnnouncementsPage(_: Props) {
  const { email, ready, uid, displayName, role, extraRoles } = useAuth();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [channel, setChannel] = useState<ChannelRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [titles, setTitles] = useState<Map<string, string>>(new Map());
  const [titlesAvailable, setTitlesAvailable] = useState(true);
  const [lastReadAt, setLastReadAt] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [sendAsInternal, setSendAsInternal] = useState(false);
  const [alsoTicker, setAlsoTicker] = useState(false);
  const [draftTickerUntil, setDraftTickerUntil] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [ticker, setTicker] = useState<MarqueeItem[]>([]);
  const [tickerOn, setTickerOn] = useState(true);
  const [, setTick] = useState(0);
  const [tickerFor, setTickerFor] = useState<MessageRow | null>(null);
  const [tickerTitle, setTickerTitle] = useState("");
  const [tickerUntil, setTickerUntil] = useState("");
  const [tickerSaving, setTickerSaving] = useState(false);
  // Local preview only (announcementSamples.ts) — never saved, never shown in production.
  const [sampleRead, setSampleRead] = useState(false);
  const samples = useMemo(() => sampleAnnouncements(), []);
  const feed = useMemo(() => [...messages, ...samples], [messages, samples]);
  const allTitles = useMemo(() => new Map([...titles, ...sampleTitles()]), [titles]);
  // With no real ticker lines yet, the preview samples stand in (local only).
  const usingSamples = ticker.length === 0 && SAMPLES_ENABLED;
  const shownTicker = usingSamples ? sampleTickerAll() : ticker;
  const isTickerOn = usingSamples ? sampleTickerEnabled() : tickerOn;

  const currentUserName = displayName || email || "Current User";
  const canPost = HIGHER_UP_ROLES.has(String(role || "").toUpperCase());

  // Resolve profile id, the announcements channel, and titles.
  useEffect(() => {
    if (!ready || !uid) return;
    let cancelled = false;
    (async () => {
      try {
        const [pid, ch, t] = await Promise.all([getMyProfileId(uid), getAnnouncementsChannel(canManageChannelsRole(role, extraRoles)), getAnnouncementTitles()]);
        if (cancelled) return;
        setProfileId(pid);
        setChannel(ch);
        setTitles(t.titles);
        setTitlesAvailable(t.available);
        const rows = await getChannelMessages(ch.id);
        if (cancelled) return;
        setMessages(rows);
        // Snapshot the current read pointer so we can paint unread chips
        // before we mark them read.
        setLastReadAt(new Date().toISOString());
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every ticker line (active and deactivated) and whether the ticker is on.
  useEffect(() => {
    if (!ready || !uid) return;
    const load = () => {
      setTick((t) => t + 1); // preview samples live in memory — re-read them too
      Promise.all([getTickerItems(), getTickerEnabled()]).then(([rows, on]) => {
        setTicker(rows);
        setTickerOn(on);
      });
    };
    load();
    window.addEventListener(MARQUEE_CHANGED_EVENT, load);
    return () => window.removeEventListener(MARQUEE_CHANGED_EVENT, load);
  }, [ready, uid]);

  // Subscribe to new announcements as they arrive (and pick up their titles).
  useEffect(() => {
    if (!channel) return;
    const unsub = subscribeToMessages({
      channelId: channel.id,
      onMessage: (row) => {
        setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
        window.setTimeout(() => getAnnouncementTitles().then((t) => setTitles(t.titles)), 1500);
      },
    });
    return unsub;
  }, [channel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const isUnread = (m: MessageRow) =>
    isSampleId(m.id) ? !sampleRead && m.id.endsWith("payroll") : !!lastReadAt && m.kind === "user" && m.sender_id !== profileId && m.created_at > lastReadAt;
  const unreadCount = useMemo(() => feed.filter(isUnread).length, [feed, lastReadAt, profileId, sampleRead]); // eslint-disable-line react-hooks/exhaustive-deps
  const tickerByMessage = useMemo(() => new Map(shownTicker.filter((t) => t.messageId).map((t) => [t.messageId!, t])), [shownTicker]);

  const post = async () => {
    if (!channel || !profileId || !canPost) return;
    const title = draftTitle.trim();
    const text = draft.trim();
    if (!title || !text) return;
    setSending(true);
    try {
      // Without the titles table (migration 0359 not run yet), the title rides along as the first line so it isn't lost.
      const body = titlesAvailable ? text : `${title}\n\n${text}`;
      const row = await sendMessageRow({
        channelId: channel.id,
        senderId: profileId,
        senderName: currentUserName,
        body,
        isAnnouncement: true,
        isInternal: sendAsInternal,
      });
      setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
      if (titlesAvailable) {
        try {
          await setAnnouncementTitle(row.id, title, currentUserName);
          setTitles((prev) => new Map(prev).set(row.id, title));
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Posted, but couldn't save the title.");
        }
      }
      if (alsoTicker) {
        try {
          await addMarquee({ messageId: row.id, text: title, endsAt: endOfDayISO(draftTickerUntil), byName: currentUserName });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Posted, but couldn't add it to the ticker.");
        }
      }
      setDraftTitle("");
      setDraft("");
      setSendAsInternal(false);
      setAlsoTicker(false);
      setDraftTickerUntil("");
      toast.success(alsoTicker ? "Announcement posted and shown in the ticker" : "Announcement posted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't post the announcement — try again.");
    } finally {
      setSending(false);
    }
  };

  const markAllRead = async () => {
    setSampleRead(true);
    if (!channel || !profileId) return;
    try {
      await markThreadRead({ profileId, channelId: channel.id });
      setLastReadAt(new Date().toISOString());
      // Tell any open Header so it can refresh its badge.
      window.dispatchEvent(new CustomEvent("ahs:unread-changed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const openTicker = (m: MessageRow) => {
    setTickerFor(m);
    setTickerTitle(allTitles.get(m.id) ?? tickerTextFrom(m.body));
    setTickerUntil("");
  };
  const saveTicker = async () => {
    if (!tickerFor || !tickerTitle.trim()) return;
    setTickerSaving(true);
    try {
      const title = tickerTitle.trim();
      // An older post without a title gets this one, so the card and the ticker match.
      if (titlesAvailable && allTitles.get(tickerFor.id) !== title) {
        await setAnnouncementTitle(tickerFor.id, title, currentUserName);
        setTitles((prev) => new Map(prev).set(tickerFor.id, title));
      }
      await addMarquee({ messageId: tickerFor.id, text: title, endsAt: endOfDayISO(tickerUntil), byName: currentUserName });
      toast.success("Activated — showing in the ticker");
      setTickerFor(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add it to the ticker.");
    } finally {
      setTickerSaving(false);
    }
  };
  const toggleLine = async (item: MarqueeItem) => {
    const next = !item.isActive;
    try {
      if (isSampleId(item.id)) setSampleActive(item.id, next);
      else await setMarqueeActive(item.id, next);
      toast.success(next ? "Activated — showing in the ticker" : "Deactivated — hidden from the ticker");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't change it — try again.");
    }
  };
  const removeLine = async (item: MarqueeItem) => {
    if (!window.confirm(`Remove "${item.text}" from the ticker? It stays on record, but you'd have to add it again to show it.`)) return;
    try {
      await removeMarquee(item.id, currentUserName);
      toast.success("Removed from the ticker");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove it — try again.");
    }
  };
  const switchTicker = async () => {
    const next = !isTickerOn;
    try {
      if (usingSamples) setSampleTickerEnabled(next);
      else await setTickerEnabled(next, currentUserName);
      toast.success(next ? "Ticker switched on for everyone" : "Ticker switched off for everyone");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't switch the ticker — try again.");
    }
  };

  if (!ready) return null;

  const q = query.trim().toLowerCase();
  const visible = feed
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .filter((m) => (filter === "unread" ? isUnread(m) : filter === "internal" ? m.is_internal : true))
    .filter((m) => !q || m.body.toLowerCase().includes(q) || (allTitles.get(m.id) ?? "").toLowerCase().includes(q) || (m.sender_name || "").toLowerCase().includes(q));

  return (
    <main className="mx-auto w-full max-w-[1200px] px-6 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="home-eyebrow" style={{ color: "#f59e0b" }}>
            Announcements
          </p>
          <h1 className="home-title">Company announcements</h1>
          <p className="home-sub">Notices for everyone at the company{canPost ? " — post new ones and pin their titles to the ticker." : "."}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`ann-pill ${unreadCount > 0 ? "ann-pill--hot" : ""}`}>{unreadCount} unread</span>
          <button type="button" onClick={markAllRead} disabled={unreadCount === 0} className="btn">
            <CheckCheck /> Mark all read
          </button>
        </div>
      </header>

      {error && <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">{error}</div>}

      {canPost && (
        <section className="ann-ticker-panel mb-6" aria-label="Ticker">
          <div className="flex flex-wrap items-center gap-2">
            <Radio className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-semibold">Ticker</h2>
            <span className="text-xs text-[var(--color-muted-foreground)]">— announcement titles scrolling under the header, seen by everyone</span>
            <button
              type="button"
              role="switch"
              aria-checked={isTickerOn}
              onClick={switchTicker}
              className={`ann-switch ml-auto ${isTickerOn ? "ann-switch--on" : ""}`}
              title={isTickerOn ? "Switch the whole ticker off" : "Switch the ticker on"}
            >
              <span className="ann-switch-knob" aria-hidden />
              {isTickerOn ? "On" : "Off"}
            </button>
          </div>
          {!isTickerOn && <p className="mt-2 text-[12px] text-amber-300">The ticker is off — nobody sees it until it's switched back on. Your lines are kept.</p>}
          {shownTicker.length === 0 ? (
            <p className="mt-2 text-[13px] text-[var(--color-muted-foreground)]">Nothing in the ticker. Use “Activate in ticker” on any announcement below.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {shownTicker.map((t) => (
                <li key={t.id} className={`flex flex-wrap items-start gap-3 rounded-lg border border-[var(--color-panel-border)] bg-[var(--color-panel)] px-3 py-2 ${t.isActive ? "" : "opacity-60"}`}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${t.isActive ? "bg-amber-400" : "bg-slate-500"}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {t.text} {!t.isActive && <span className="ann-tag ann-tag--off align-middle">Deactivated</span>}{" "}
                      {isSampleId(t.id) && <span className="ann-tag ann-tag--sample align-middle">Sample</span>}
                    </p>
                    <p className="text-[11px] text-[var(--color-muted-foreground)]">
                      Added by {t.createdByName || "someone"} · {relativeTime(t.createdAt)} · {t.endsAt ? `until ${formatTimestamp(t.endsAt)}` : "no end date"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button type="button" onClick={() => toggleLine(t)} className={`btn btn-sm ${t.isActive ? "" : "btn-primary"}`}>
                      {t.isActive ? <Pause /> : <Play />} {t.isActive ? "Deactivate" : "Activate"}
                    </button>
                    {!isSampleId(t.id) && (
                      <button type="button" onClick={() => removeLine(t)} className="btn btn-ghost btn-sm" title="Remove from the ticker" aria-label="Remove from the ticker">
                        <Trash2 />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className={`grid gap-6 ${canPost ? "lg:grid-cols-[minmax(0,1fr)_22rem]" : ""}`}>
        <section aria-label="Announcement feed" className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {(["all", "unread", "internal"] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} className={`ann-chip ${filter === f ? "ann-chip--on" : ""}`}>
                {f === "all" ? "All" : f === "unread" ? `Unread${unreadCount ? ` · ${unreadCount}` : ""}` : "Internal"}
              </button>
            ))}
            <label className="relative ml-auto w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search announcements" className="glass-input w-full rounded-lg py-1.5 pl-8 pr-3 text-sm" />
            </label>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="ui-skeleton h-36 rounded-xl" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--color-panel-border)]">
              <EmptyState
                icon={<Megaphone />}
                title={feed.length === 0 ? "No announcements yet" : "Nothing matches"}
                hint={feed.length === 0 ? (canPost ? "Post the first one from the panel on the right." : "Company notices will show up here.") : "Try another filter or search."}
              />
            </div>
          ) : (
            <ol className="space-y-3">
              {visible.map((m) => {
                const unread = isUnread(m);
                const inTicker = tickerByMessage.get(m.id);
                const title = allTitles.get(m.id);
                return (
                  <li key={m.id} className={`ann-card ${unread ? "ann-card--unread" : ""}`}>
                    <div className="flex items-start gap-3">
                      <span className="ann-avatar" aria-hidden>
                        {initials(m.sender_name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        {title && <h3 className="ann-title">{title}</h3>}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className={title ? "text-xs text-[var(--color-muted-foreground)]" : "text-sm font-semibold"}>{m.sender_name || "Unknown"}</span>
                          {m.is_internal && <span className="ann-tag ann-tag--internal">Internal</span>}
                          {inTicker && (inTicker.isActive ? <span className="ann-tag ann-tag--ticker">In ticker</span> : <span className="ann-tag ann-tag--off">Ticker · off</span>)}
                          {unread && <span className="ann-tag ann-tag--unread">New</span>}
                          {isSampleId(m.id) && (
                            <span className="ann-tag ann-tag--sample" title="Preview only — shown on this computer while running locally">
                              Sample
                            </span>
                          )}
                          <time className="ml-auto text-xs text-[var(--color-muted-foreground)]" dateTime={m.created_at} title={formatTimestamp(m.created_at)}>
                            {relativeTime(m.created_at)}
                          </time>
                        </div>
                        <Paragraphs text={m.body} />
                        {canPost && (!isSampleId(m.id) || inTicker) && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {inTicker ? (
                              <button type="button" onClick={() => toggleLine(inTicker)} className={`btn btn-sm ${inTicker.isActive ? "" : "btn-primary"}`}>
                                {inTicker.isActive ? <Pause /> : <Play />} {inTicker.isActive ? "Deactivate in ticker" : "Activate in ticker"}
                              </button>
                            ) : (
                              <button type="button" onClick={() => openTicker(m)} className="btn btn-sm">
                                <Play /> Activate in ticker
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {canPost ? (
          <aside className="lg:sticky lg:top-24 h-fit">
            <div className="ann-composer">
              <h2 className="text-sm font-semibold">New announcement</h2>
              <label className="mt-3 block">
                <span className="mb-1 block text-xs font-semibold">Title</span>
                <input
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  maxLength={TITLE_MAX}
                  placeholder="e.g. Payroll cut-off moves to Thursday"
                  className="glass-input w-full rounded-lg px-3 py-2 text-sm font-semibold"
                />
                <span className="mt-1 block text-[11px] text-[var(--color-muted-foreground)]">
                  {draftTitle.length}/{TITLE_MAX} · shown in the ticker
                </span>
              </label>
              <label className="mt-3 block">
                <span className="mb-1 block text-xs font-semibold">Message</span>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Write the announcement… Leave a blank line between paragraphs."
                  rows={8}
                  className="glass-input w-full rounded-lg px-3 py-2 text-sm leading-6"
                />
              </label>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={sendAsInternal} onChange={(e) => setSendAsInternal(e.target.checked)} className="h-4 w-4 accent-amber-400" />
                Internal announcement
              </label>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={alsoTicker} onChange={(e) => setAlsoTicker(e.target.checked)} className="h-4 w-4 accent-amber-400" />
                Show the title in the ticker
              </label>
              {alsoTicker && (
                <label className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-[var(--color-muted-foreground)]">
                  Until
                  <input type="date" value={draftTickerUntil} onChange={(e) => setDraftTickerUntil(e.target.value)} className="glass-input rounded-md px-2 py-1 text-xs" />
                  <span>(blank = until taken down)</span>
                </label>
              )}
              {!titlesAvailable && (
                <p className="mt-3 text-[11px] text-amber-300">Titles aren't set up yet (migration 0359) — the title will be added as the first line of the message for now.</p>
              )}
              <button type="button" onClick={post} disabled={!draftTitle.trim() || !draft.trim() || sending} className="btn btn-primary mt-4 w-full">
                <Send /> {sending ? "Posting…" : "Post announcement"}
              </button>
            </div>
          </aside>
        ) : (
          <p className="text-xs text-[var(--color-muted-foreground)]">{HIGHER_UP_HINT}</p>
        )}
      </div>

      {tickerFor && (
        <AppModal
          size="md"
          title="Activate in the ticker"
          description="The title scrolls under the header for everyone. Clicking it opens Announcements."
          busy={tickerSaving}
          onClose={() => setTickerFor(null)}
          footer={
            <>
              <button type="button" onClick={() => setTickerFor(null)} disabled={tickerSaving} className="btn">
                Cancel
              </button>
              <button type="button" onClick={saveTicker} disabled={tickerSaving || !tickerTitle.trim()} className="btn btn-primary">
                <Play /> {tickerSaving ? "Saving…" : "Activate"}
              </button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            <div>
              <label className="mb-1 block text-xs font-semibold">Title</label>
              <input value={tickerTitle} onChange={(e) => setTickerTitle(e.target.value)} maxLength={TITLE_MAX} className="glass-input w-full rounded-md px-3 py-2 text-sm font-semibold" />
              <p className="mt-1 text-[11px] text-[var(--color-muted-foreground)]">
                {allTitles.get(tickerFor.id) ? `${tickerTitle.length}/${TITLE_MAX}` : `This post has no title yet — this becomes its title. ${tickerTitle.length}/${TITLE_MAX}`}
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold">Show until</label>
              <input type="date" value={tickerUntil} onChange={(e) => setTickerUntil(e.target.value)} className="glass-input rounded-md px-3 py-2 text-sm" />
              <p className="mt-1 text-[11px] text-[var(--color-muted-foreground)]">Leave blank to keep it up until someone takes it down.</p>
            </div>
          </div>
        </AppModal>
      )}
    </main>
  );
}
