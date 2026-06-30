/**
 * Announcements Page — Supabase backed.
 *
 * Reads the company's #announcements channel from the messaging tables, lets
 * higher-up roles post new ones, and tracks per-user read state via the
 * message_reads table (so "unread" counts persist across devices).
 */

import { useEffect, useMemo, useState } from "react";
import { Megaphone, Send } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
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

interface Props {
  mod?: ModuleDef;
  sub?: SubModuleDef;
}

const HIGHER_UP_HINT = "Only HR, managers, admins, and supervisors can post announcements.";

const HIGHER_UP_ROLES = new Set([
  "SUPERADMIN",
  "ADMIN",
  "MANAGER",
  "HR",
  "BRANCH_MANAGER",
  "SENIOR_BRANCH_MANAGER",
  "CSR_MANAGER",
  "CLAIMS_MANAGER",
  "PARTS_MANAGER",
  "BIZOPS_MANAGER",
  "BIZOPS_SENIOR_MANAGER",
]);

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function AnnouncementsPage(_: Props) {
  const { email, ready, uid, displayName, role } = useAuth();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [channel, setChannel] = useState<ChannelRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [lastReadAt, setLastReadAt] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentUserName = displayName || email || "Current User";
  const canPost = HIGHER_UP_ROLES.has(String(role || "").toUpperCase());

  // Resolve profile id and the announcements channel.
  useEffect(() => {
    if (!ready || !uid) return;
    let cancelled = false;
    (async () => {
      try {
        const [pid, ch] = await Promise.all([
          getMyProfileId(uid),
          getAnnouncementsChannel(),
        ]);
        if (cancelled) return;
        setProfileId(pid);
        setChannel(ch);
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
    return () => { cancelled = true; };
  }, [ready, uid]);

  // Subscribe to new announcements as they arrive.
  useEffect(() => {
    if (!channel) return;
    const unsub = subscribeToMessages({
      channelId: channel.id,
      onMessage: (row) => {
        setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
      },
    });
    return unsub;
  }, [channel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const unreadCount = useMemo(() => {
    if (!lastReadAt) return 0;
    return messages.filter(
      (m) => m.kind === "user" && m.sender_id !== profileId && m.created_at > lastReadAt
    ).length;
  }, [messages, lastReadAt, profileId]);

  const post = async () => {
    if (!channel || !profileId || !canPost) return;
    const body = draft.trim();
    if (!body) return;
    try {
      const row = await sendMessageRow({
        channelId: channel.id,
        senderId: profileId,
        senderName: currentUserName,
        body,
        isAnnouncement: true,
      });
      setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const markAllRead = async () => {
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

  if (!ready) return null;

  const visible = messages.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-amber-200/80">Announcements</div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">Company Announcements</h1>
          <p className="mt-2 text-sm text-slate-300">Read company notices, mark them as read, and post new ones if your role allows it.</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-right text-sm text-slate-300 backdrop-blur-md">
          <div className="font-semibold text-white">{currentUserName}</div>
          <div>{unreadCount} unread</div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="rounded-2xl border border-white/15 bg-white/8 p-4 text-white backdrop-blur-md">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-amber-200" />
              <div className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-300">Announcement feed</div>
            </div>
            <button type="button" onClick={markAllRead} className="btn text-sm">
              Mark all read
            </button>
          </div>

          {loading ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/70 p-6 text-sm text-slate-400">
              Loading…
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/70 p-6 text-sm text-slate-400">
              No announcements have been posted yet.
            </div>
          ) : (
            <div className="space-y-3">
              {visible.map((m) => {
                const isUnread = !!lastReadAt && m.kind === "user" && m.sender_id !== profileId && m.created_at > lastReadAt;
                return (
                  <div
                    key={m.id}
                    className={`rounded-2xl border bg-slate-950/80 p-4 ${
                      isUnread ? "border-amber-300/40" : "border-white/10"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white">{m.sender_name || "Unknown"}</div>
                        <div className="text-[11px] uppercase tracking-[0.12em] text-slate-400">{formatTimestamp(m.created_at)}</div>
                      </div>
                      {isUnread && (
                        <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-100">
                          Unread
                        </span>
                      )}
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-200">{m.body}</p>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-white/15 bg-white/8 p-4 text-white backdrop-blur-md">
            <div className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-300">Post announcement</div>
            <p className="mt-2 text-sm text-slate-300">{canPost ? "Your role can post announcements." : HIGHER_UP_HINT}</p>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!canPost}
              placeholder="Type a company announcement..."
              className="glass-input mt-4 min-h-36 w-full rounded-xl bg-slate-900 text-white placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="button"
              onClick={post}
              disabled={!canPost || !draft.trim()}
              className="btn btn-primary mt-3 inline-flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> Send announcement
            </button>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/8 p-4 text-white backdrop-blur-md">
            <div className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-300">How unread works</div>
            <p className="mt-2 text-sm text-slate-300">
              "Mark all read" stores your last-seen timestamp in Supabase, so the unread badge on the message icon stays accurate across devices.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
