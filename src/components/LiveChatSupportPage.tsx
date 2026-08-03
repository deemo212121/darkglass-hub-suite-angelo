/**
 * Live Chat — staff inbox for the public landing-page widget (see
 * src/components/LiveChatWidget.tsx and migration 0091). Unlike Team
 * Messenger, the other side of this conversation has no AHS account —
 * every visitor message came in through the anonymous service-role bridge
 * (src/lib/server/liveChatBridge.ts), while staff read/reply here directly
 * under normal RLS (src/lib/supabase/liveChat.ts).
 *
 * Realtime + a short polling fallback, same belt-and-suspenders approach
 * as TeamMessenger.tsx — some tenants may not have realtime enabled for
 * these tables yet.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeftRight,
  CalendarDays,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  Copy,
  Home,
  MessageCircle,
  MessageSquareText,
  Paperclip,
  Pencil,
  Phone,
  Search,
  Send,
  Sparkles,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { getCompanyUsers, getMyProfileId, getMyRoles, type ProfileRow } from "@/lib/supabase/users";
import { subscribeTableChanges } from "@/lib/supabase/realtime";
import { LOCATIONS } from "@/lib/locations";
import { getCsrTeamComposition, type CsrTeamMemberRow } from "@/lib/supabase/csrTeams";
import { createNotification } from "@/lib/supabase/notifications";
import { hasDashboardAccess } from "@/lib/dashboardAccess";
import {
  addLiveChatInternalNote,
  assistLiveChatSession,
  closeLiveChatSession,
  createSavedReply,
  deleteSavedReply,
  getLiveChatMessages,
  getSavedReplies,
  listLiveChatSessions,
  proposeLiveChatCallback,
  releaseLiveChatSession,
  requestLiveChatAppointment,
  respondToLiveChatRequest,
  sendLiveChatStaffReply,
  setLiveChatEscalated,
  setLiveChatStaffTyping,
  transferLiveChatSession,
  updateSavedReply,
  type LiveChatMessageRow,
  type LiveChatSavedReplyRow,
  type LiveChatSessionRow,
} from "@/lib/supabase/liveChat";

// Anyone who could plausibly pick up or be handed a chat — same roles as
// is_csr_wide_visibility() (migration 0093) plus the agent/team-leader tier.
const LIVE_CHAT_ELIGIBLE_ROLES = new Set([
  "ADMIN",
  "SUPERADMIN",
  "CSR_MANAGER",
  "BIZOPS_MANAGER",
  "BIZOPS_SENIOR_MANAGER",
  "CSR_AGENT",
  "CSR_TEAM_LEADER",
]);

const CALLBACK_PREFERENCE_LABELS: Record<string, string> = { now: "Now", "30min": "In 30 minutes", tomorrow: "Tomorrow" };
// "custom" has no fixed label — the customer typed their own preferred time
// (request_data.customTime) instead, so this falls back to that.
function callbackLabel(preference: string | undefined, customTime: string | null | undefined): string {
  if (!preference) return "";
  if (preference === "custom") return customTime || "a custom time";
  return CALLBACK_PREFERENCE_LABELS[preference] ?? preference;
}
const APPOINTMENT_WINDOWS = ["9:00 AM - 12:00 PM", "12:00 PM - 3:00 PM", "3:00 PM - 6:00 PM"];
// Parallel to APPOINTMENT_WINDOWS — the hour each window starts, used to pick
// the next one that hasn't started yet (with a buffer so we don't recommend
// a window that's about to start in the next hour).
const APPOINTMENT_WINDOW_START_HOURS = [9, 12, 15];
const APPOINTMENT_RECOMMEND_BUFFER_HOURS = 1;

/** No real capacity/technician data to schedule against, so this is a simple "next window that hasn't started yet" heuristic rather than true availability — staff can always override it. */
function recommendAppointmentSlot(): { day: "today" | "tomorrow"; window: string } {
  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;
  const idx = APPOINTMENT_WINDOW_START_HOURS.findIndex((start) => start > currentHour + APPOINTMENT_RECOMMEND_BUFFER_HOURS);
  if (idx !== -1) return { day: "today", window: APPOINTMENT_WINDOWS[idx] };
  return { day: "tomorrow", window: APPOINTMENT_WINDOWS[0] };
}

// Don't fire a new "typing" ping more than once per this many ms — the
// visitor's own poll only checks every few seconds anyway.
const TYPING_THROTTLE_MS = 2000;
// A "visitor is typing" timestamp older than this reads as stale.
const TYPING_RECENCY_MS = 6000;
// visitor_last_seen_at is refreshed on every widget poll (~3s) — a bit more
// than that plus network slack before the online dot turns itself off.
const PRESENCE_RECENCY_MS = 10000;

function isRecent(iso: string | null | undefined, withinMs: number): boolean {
  return !!iso && Date.now() - new Date(iso).getTime() < withinMs;
}

/** A short, stable reference customers/staff can say out loud — derived from the id itself rather than a separate counter column. */
function ticketNumber(sessionId: string): string {
  return `LC-${sessionId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

// One shared AudioContext, reused for every beep rather than a fresh one
// per call (browsers cap how many can exist, and it avoids audible clicks
// from repeatedly spinning one up).
let notifyAudioCtx: AudioContext | null = null;
function playNotificationSound() {
  try {
    if (!notifyAudioCtx) notifyAudioCtx = new AudioContext();
    const ctx = notifyAudioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // Audio blocked (e.g. no user interaction yet) — not worth surfacing to the user.
  }
}

/** The widget's pre-chat form sends the opening message as "Concern: X\nAppliance: Y" (see LiveChatWidget.tsx) — pull those back out so the details panel can show them as labeled fields instead of making a CSR re-read the chat bubble. */
function parseIntake(messages: LiveChatMessageRow[]): { concern: string | null; appliance: string | null } {
  const opener = messages.find((m) => m.sender === "visitor")?.body ?? "";
  return {
    concern: opener.match(/Concern:\s*(.+)/)?.[1]?.trim() ?? null,
    appliance: opener.match(/Appliance:\s*(.+)/)?.[1]?.trim() ?? null,
  };
}

interface Props {
  mod: ModuleDef;
  sub: SubModuleDef;
}

// Same tier as is_csr_wide_visibility() in migration 0093 — full,
// unrestricted company-wide visibility instead of just "mine"/"my team".
const WIDE_VISIBILITY_ROLES = ["ADMIN", "SUPERADMIN", "CSR_MANAGER", "BIZOPS_MANAGER", "BIZOPS_SENIOR_MANAGER"];

type ViewTab = "queue" | "mine" | "team" | "all" | "escalated" | "transferred";

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function LiveChatSupportPage({ mod, sub }: Props) {
  const { uid, role, displayName, email } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [extraRoles, setExtraRoles] = useState<string[]>([]);
  // null = not (yet known to be) a team leader; an array = the profile ids
  // of everyone on the team this person leads, including themselves.
  const [myTeamMemberIds, setMyTeamMemberIds] = useState<string[] | null>(null);
  const [viewTab, setViewTab] = useState<ViewTab>("mine");
  const [sessions, setSessions] = useState<LiveChatSessionRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LiveChatMessageRow[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [savedReplies, setSavedReplies] = useState<LiveChatSavedReplyRow[]>([]);
  const [savedRepliesOpen, setSavedRepliesOpen] = useState(false);
  const [editingSavedReplyId, setEditingSavedReplyId] = useState<string | null>(null);
  const [savedReplyLabel, setSavedReplyLabel] = useState("");
  const [savedReplyBody, setSavedReplyBody] = useState("");
  const [savingSavedReply, setSavingSavedReply] = useState(false);
  const [closing, setClosing] = useState(false);
  const [assistingId, setAssistingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState("");
  const [readFilter, setReadFilter] = useState<"all" | "unread" | "read">("all");
  const [search, setSearch] = useState("");
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [companyStaff, setCompanyStaff] = useState<ProfileRow[]>([]);
  const [csrTeamMembers, setCsrTeamMembers] = useState<CsrTeamMemberRow[]>([]);
  const [transferMenuOpen, setTransferMenuOpen] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [pendingTransfer, setPendingTransfer] = useState<{ id: string; name: string } | null>(null);
  const [escalating, setEscalating] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDay, setScheduleDay] = useState<"today" | "tomorrow" | "custom">("today");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleWindow, setScheduleWindow] = useState(APPOINTMENT_WINDOWS[0]);
  const [scheduling, setScheduling] = useState(false);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [counteringId, setCounteringId] = useState<string | null>(null);
  const [counterCallbackPreference, setCounterCallbackPreference] = useState<"now" | "30min" | "tomorrow">("now");
  const [counterDay, setCounterDay] = useState<"today" | "tomorrow" | "custom">("today");
  const [counterDate, setCounterDate] = useState("");
  const [counterWindow, setCounterWindow] = useState(APPOINTMENT_WINDOWS[0]);
  const [counterNote, setCounterNote] = useState("");
  const [phoneCopied, setPhoneCopied] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const lastTypingSentAtRef = useRef(0);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevMessageIdsRef = useRef<Set<string>>(new Set());
  const prevSessionIdsRef = useRef<Set<string> | null>(null);
  const photosRef = useRef<HTMLDivElement>(null);

  const currentUserName = displayName || email || "Staff";
  const active = sessions.find((s) => s.id === activeId) ?? null;
  const isWideVisibility = hasDashboardAccess(WIDE_VISIBILITY_ROLES, role, extraRoles);
  const isTeamLeader = myTeamMemberIds !== null;

  // Normally only the assigned agent can reply — everyone else is read-only
  // (see the "assisting this chat" message below). Escalation carves out one
  // exception: once a chat is escalated, whoever has wide (manager-tier)
  // visibility, or is the assigned agent's own team leader, can step in and
  // reply too — without taking the chat over (no Transfer needed).
  const canReplyToActive =
    !!active &&
    (!active.assigned_to ||
      active.assigned_to === myProfileId ||
      (active.escalated && (isWideVisibility || (myTeamMemberIds?.includes(active.assigned_to) ?? false))));

  // "Queue" is the shared pool waiting to be picked up. "My Chats" is only
  // what's actually assigned to me — no longer conflated with the queue, so
  // "how much active work do I have" and "what's waiting" read as two
  // different questions. "My Team"/"All Teams" are monitoring views of
  // who's currently assisting what.
  const tabScopedSessions =
    viewTab === "queue"
      ? sessions.filter((s) => !s.assigned_to)
      : viewTab === "mine"
      ? sessions.filter((s) => s.assigned_to === myProfileId)
      : viewTab === "team"
      ? sessions.filter((s) => s.assigned_to && s.assigned_to !== myProfileId && myTeamMemberIds?.includes(s.assigned_to))
      : viewTab === "escalated"
      ? sessions.filter((s) => s.escalated)
      : viewTab === "transferred"
      ? sessions.filter((s) => !!s.transferred_from)
      : sessions.filter((s) => !!s.assigned_to);
  const readFilteredSessions =
    readFilter === "unread"
      ? tabScopedSessions.filter((s) => s.unreadCount > 0)
      : readFilter === "read"
      ? tabScopedSessions.filter((s) => s.unreadCount === 0)
      : tabScopedSessions;
  const branchFilteredSessions = branchFilter ? readFilteredSessions.filter((s) => s.branch === branchFilter) : readFilteredSessions;
  const searchTerm = search.trim().toLowerCase();
  const visibleSessions = searchTerm
    ? branchFilteredSessions.filter((s) =>
        [s.visitor_name, s.visitor_phone, s.branch, s.concern, s.appliance, ticketNumber(s.id)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(searchTerm)
      )
    : branchFilteredSessions;
  const parsedIntake = parseIntake(messages);
  const intake = { concern: active?.concern ?? parsedIntake.concern, appliance: active?.appliance ?? parsedIntake.appliance };
  const photoMessages = messages.filter((m) => m.attachment_url && m.attachment_mime_type?.startsWith("image/"));
  const transferCandidates = companyStaff.filter((u) => {
    if (u.id === myProfileId || u.id === active?.assigned_to || !u.is_active) return false;
    const roles = [u.role, ...(u.extra_roles ?? [])].map((r) => (r || "").toUpperCase());
    return roles.some((r) => LIVE_CHAT_ELIGIBLE_ROLES.has(r));
  });

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    getMyProfileId(uid).then((id) => { if (!cancelled) setMyProfileId(id); });
    getMyRoles(uid).then(({ extraRoles }) => { if (!cancelled) setExtraRoles(extraRoles); });
    return () => { cancelled = true; };
  }, [uid]);

  // Am I the leader of a CSR team? If so, everyone on that team (Team
  // Composition, migration 0031) becomes the "My Team" tab's scope.
  useEffect(() => {
    if (!myProfileId) return;
    let cancelled = false;
    getCsrTeamComposition()
      .then(({ members }) => {
        if (cancelled) return;
        setCsrTeamMembers(members);
        const myTeamId = members.find((m) => m.profileId === myProfileId && m.isLeader)?.teamId;
        setMyTeamMemberIds(myTeamId ? members.filter((m) => m.teamId === myTeamId).map((m) => m.profileId) : null);
      })
      .catch(() => { if (!cancelled) setMyTeamMemberIds(null); });
    return () => { cancelled = true; };
  }, [myProfileId]);

  // Candidates for the "Transfer" picker — loaded once, filtered client-side.
  useEffect(() => {
    let cancelled = false;
    getCompanyUsers()
      .then((users) => { if (!cancelled) setCompanyStaff(users); })
      .catch((err) => console.error("Failed to load company staff for transfer:", err));
    return () => { cancelled = true; };
  }, []);

  const loadSavedReplies = () => {
    getSavedReplies()
      .then(setSavedReplies)
      .catch((err) => console.error("Failed to load saved replies:", err));
  };

  // Company-wide canned replies — loaded once, any CSR can use/edit/delete any of them.
  useEffect(() => {
    loadSavedReplies();
  }, []);

  const loadSessions = () => {
    listLiveChatSessions()
      .then((rows) => {
        // Skip the very first load (prevSessionIdsRef starts null) — every
        // session would otherwise look "new" the moment the page opens.
        if (prevSessionIdsRef.current) {
          const hasNewInquiry = rows.some((r) => r.status === "open" && !prevSessionIdsRef.current!.has(r.id));
          if (hasNewInquiry) playNotificationSound();
        }
        prevSessionIdsRef.current = new Set(rows.map((r) => r.id));
        setSessions(rows);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  // 1. Load sessions, then keep them fresh via realtime + a polling fallback.
  useEffect(() => {
    loadSessions();
    const unsubscribe = subscribeTableChanges("live_chat_sessions", loadSessions);
    const pollId = window.setInterval(loadSessions, 5000);
    return () => {
      unsubscribe();
      window.clearInterval(pollId);
    };
  }, []);

  // 2. Load the active thread's messages, then keep them fresh the same way.
  useEffect(() => {
    // Switching threads — reset the "what have I already seen" bookkeeping
    // so the next load is treated as an initial populate, not new arrivals.
    prevMessageIdsRef.current = new Set();
    isAtBottomRef.current = true;
    setNewMessageCount(0);
    setTransferMenuOpen(false);
    setNoteOpen(false);
    setScheduleOpen(false);

    if (!activeId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    getLiveChatMessages(activeId)
      .then((rows) => { if (!cancelled) setMessages(rows); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });

    const refetch = () => {
      getLiveChatMessages(activeId).then((rows) => { if (!cancelled) setMessages(rows); }).catch(() => {});
    };
    const unsubscribe = subscribeTableChanges("live_chat_messages", refetch, `session_id=eq.${activeId}`);
    const pollId = window.setInterval(refetch, 4000);
    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(pollId);
    };
  }, [activeId]);

  // 3. Whenever the message list actually changes: jump straight to the
  // bottom on the initial populate of a thread; for later updates, only
  // auto-follow if the viewer was already at the bottom, otherwise surface
  // the floating "New Messages" button instead of yanking their scroll
  // position out from under them.
  useEffect(() => {
    const newIncoming = messages.filter((m) => m.sender === "visitor" && !prevMessageIdsRef.current.has(m.id));
    const isInitialPopulate = prevMessageIdsRef.current.size === 0;
    prevMessageIdsRef.current = new Set(messages.map((m) => m.id));

    if (isInitialPopulate) {
      endRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
      return;
    }
    if (newIncoming.length === 0) {
      if (isAtBottomRef.current) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      return;
    }
    playNotificationSound();
    if (isAtBottomRef.current) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    } else {
      setNewMessageCount((n) => n + newIncoming.length);
    }
  }, [messages]);

  const handleMessagesScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (isAtBottomRef.current) setNewMessageCount(0);
  };

  const scrollToLatest = () => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    setNewMessageCount(0);
  };

  // Shared by the composer (handleSend) and one-click saved replies — both
  // need the exact same auto-claim-on-first-reply behavior.
  const sendReply = async (body: string): Promise<boolean> => {
    if (!body.trim() || !activeId || !myProfileId || sending) return false;
    if (!canReplyToActive) return false; // someone else already has this one (and it's not an escalation you can step into)
    setSending(true);
    setError(null);
    try {
      // First reply on an unclaimed chat auto-claims it — race-safe against
      // another staff member doing the same thing at the same moment (see
      // assistLiveChatSession). No separate "click Assist first" step to forget.
      // Stepping into someone else's escalated chat does NOT auto-claim it —
      // only a genuinely unassigned chat does.
      if (!active?.assigned_to) {
        const { claimed } = await assistLiveChatSession(activeId, myProfileId, currentUserName);
        if (!claimed) {
          loadSessions();
          setError("Someone else just picked this chat up.");
          return false;
        }
      }
      await sendLiveChatStaffReply(activeId, currentUserName, body.trim());
      const rows = await getLiveChatMessages(activeId);
      setMessages(rows);
      loadSessions();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reply.");
      return false;
    } finally {
      setSending(false);
    }
  };

  const handleSend = async () => {
    if (await sendReply(draft)) setDraft("");
  };

  const handleSendSavedReply = async (body: string) => {
    if (await sendReply(body)) setSavedRepliesOpen(false);
  };

  const resetSavedReplyForm = () => {
    setEditingSavedReplyId(null);
    setSavedReplyLabel("");
    setSavedReplyBody("");
  };

  const handleEditSavedReply = (reply: LiveChatSavedReplyRow) => {
    setEditingSavedReplyId(reply.id);
    setSavedReplyLabel(reply.label);
    setSavedReplyBody(reply.body);
  };

  const handleSaveSavedReply = async () => {
    if (!savedReplyLabel.trim() || !savedReplyBody.trim() || savingSavedReply) return;
    setSavingSavedReply(true);
    try {
      if (editingSavedReplyId) {
        await updateSavedReply(editingSavedReplyId, savedReplyLabel.trim(), savedReplyBody.trim());
      } else {
        await createSavedReply(savedReplyLabel.trim(), savedReplyBody.trim());
      }
      resetSavedReplyForm();
      loadSavedReplies();
    } catch (err) {
      alert(`Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingSavedReply(false);
    }
  };

  const handleDeleteSavedReply = async (id: string) => {
    if (!confirm("Delete this saved reply?")) return;
    try {
      await deleteSavedReply(id);
      if (editingSavedReplyId === id) resetSavedReplyForm();
      loadSavedReplies();
    } catch (err) {
      alert(`Failed to delete: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);
    if (!activeId) return;
    const now = Date.now();
    if (now - lastTypingSentAtRef.current < TYPING_THROTTLE_MS) return;
    lastTypingSentAtRef.current = now;
    void setLiveChatStaffTyping(activeId);
  };

  const handleResolve = async () => {
    if (!activeId || closing) return;
    setClosing(true);
    setError(null);
    try {
      await closeLiveChatSession(activeId);
      loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve chat.");
    } finally {
      setClosing(false);
    }
  };

  const handleTransfer = async (toProfileId: string, toName: string) => {
    if (!activeId || transferring) return;
    setTransferring(true);
    setError(null);
    try {
      await transferLiveChatSession(activeId, toProfileId, toName);
      setTransferMenuOpen(false);
      loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to transfer chat.");
    } finally {
      setTransferring(false);
    }
  };

  // Notifies the escalating agent's OWN team leader AND manager — both, not
  // whichever resolves first (unlike resolveTeamLeadOrManager's either/or
  // fallback used elsewhere, e.g. Attendance Monitoring's "Notify Team
  // Lead"). Best-effort: a failed notification should never block the
  // escalation itself from having been recorded.
  const notifyEscalation = async (session: LiveChatSessionRow) => {
    if (!myProfileId) return;
    const me = companyStaff.find((p) => p.id === myProfileId);
    const recipientIds = new Set<string>();

    const myTeamId = csrTeamMembers.find((m) => m.profileId === myProfileId)?.teamId;
    if (myTeamId) {
      const leader = csrTeamMembers.find((m) => m.teamId === myTeamId && m.isLeader);
      if (leader && leader.profileId !== myProfileId) recipientIds.add(leader.profileId);
    }

    const managerName = (me?.manager_name || "").trim().toLowerCase();
    if (managerName) {
      const manager = companyStaff.find((p) => (p.display_name || "").trim().toLowerCase() === managerName);
      if (manager && manager.id !== myProfileId) recipientIds.add(manager.id);
    }

    if (recipientIds.size === 0) return;
    const body = `🚨 ${currentUserName} escalated a Live Chat — ${session.visitor_name || "a visitor"} (${ticketNumber(session.id)})`;
    await Promise.all(
      Array.from(recipientIds).map((recipientId) =>
        createNotification({
          recipientId,
          senderId: myProfileId,
          senderName: currentUserName,
          body,
          linkTo: "/m/dashboard/live-chat-support",
        }).catch((err) => console.error("Failed to notify escalation recipient:", err))
      )
    );
  };

  const handleEscalateToggle = async () => {
    if (!activeId || !active || escalating) return;
    setEscalating(true);
    setError(null);
    try {
      const nextEscalated = !active.escalated;
      await setLiveChatEscalated(activeId, nextEscalated);
      if (nextEscalated) void notifyEscalation(active);
      loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update escalation.");
    } finally {
      setEscalating(false);
    }
  };

  const handleAddNote = async () => {
    if (!activeId || !noteDraft.trim() || savingNote) return;
    setSavingNote(true);
    setError(null);
    try {
      await addLiveChatInternalNote(activeId, currentUserName, noteDraft.trim());
      setNoteDraft("");
      setNoteOpen(false);
      const rows = await getLiveChatMessages(activeId);
      setMessages(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save note.");
    } finally {
      setSavingNote(false);
    }
  };

  const handleRecommendSchedule = () => {
    const { day, window } = recommendAppointmentSlot();
    setScheduleDay(day);
    setScheduleWindow(window);
  };

  const handleStaffSchedule = async () => {
    if (!activeId || scheduling) return;
    if (scheduleDay === "custom" && !scheduleDate) return;
    setScheduling(true);
    setError(null);
    try {
      await requestLiveChatAppointment(activeId, currentUserName, scheduleDay, scheduleDay === "custom" ? scheduleDate : null, scheduleWindow);
      setScheduleOpen(false);
      const rows = await getLiveChatMessages(activeId);
      setMessages(rows);
      loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to propose an appointment.");
    } finally {
      setScheduling(false);
    }
  };

  const handleViewAttachments = () => {
    photosRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleCopyPhone = (phone: string) => {
    navigator.clipboard.writeText(phone).then(() => {
      setPhoneCopied(true);
      setTimeout(() => setPhoneCopied(false), 1500);
    });
  };

  const handleAcceptRequest = async (m: LiveChatMessageRow) => {
    if (respondingId) return;
    setRespondingId(m.id);
    setError(null);
    try {
      await respondToLiveChatRequest(m.id, m.request_data, "accepted");
      const confirmation =
        m.kind === "callback_request"
          ? `Confirmed — we'll call you ${callbackLabel(m.request_data?.preference, m.request_data?.customTime) || "soon"}.`
          : `Confirmed — we'll see you ${
              m.request_data?.day === "today" ? "today" : m.request_data?.day === "tomorrow" ? "tomorrow" : m.request_data?.date || "as requested"
            }${m.request_data?.window ? `, ${m.request_data.window}` : ""}.`;
      await sendLiveChatStaffReply(activeId!, currentUserName, confirmation);
      const rows = await getLiveChatMessages(activeId!);
      setMessages(rows);
      loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept request.");
    } finally {
      setRespondingId(null);
    }
  };

  const handleOpenCounter = (m: LiveChatMessageRow) => {
    setCounteringId(m.id);
    setCounterNote("");
    if (m.kind === "callback_request") setCounterCallbackPreference("now");
    else {
      setCounterDay("today");
      setCounterDate("");
      setCounterWindow(APPOINTMENT_WINDOWS[0]);
    }
  };

  const handleRecommendCounter = () => {
    const { day, window } = recommendAppointmentSlot();
    setCounterDay(day);
    setCounterWindow(window);
  };

  const handleSubmitCounter = async (m: LiveChatMessageRow) => {
    if (!activeId || respondingId) return;
    if (m.kind === "appointment_request" && counterDay === "custom" && !counterDate) return;
    setRespondingId(m.id);
    setError(null);
    try {
      await respondToLiveChatRequest(m.id, m.request_data, "declined");
      if (m.kind === "callback_request") {
        await proposeLiveChatCallback(activeId, currentUserName, counterCallbackPreference, counterNote);
      } else {
        await requestLiveChatAppointment(activeId, currentUserName, counterDay, counterDay === "custom" ? counterDate : null, counterWindow, counterNote);
      }
      setCounteringId(null);
      setCounterNote("");
      const rows = await getLiveChatMessages(activeId);
      setMessages(rows);
      loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to suggest a different time.");
    } finally {
      setRespondingId(null);
    }
  };

  const handleAssist = async (sessionId: string) => {
    if (!myProfileId || assistingId) return;
    setAssistingId(sessionId);
    setError(null);
    try {
      const { claimed } = await assistLiveChatSession(sessionId, myProfileId, currentUserName);
      loadSessions();
      if (!claimed) setError("Someone else just picked this chat up.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assist chat.");
    } finally {
      setAssistingId(null);
    }
  };

  const handleRelease = async (sessionId: string) => {
    if (!myProfileId || assistingId) return;
    setAssistingId(sessionId);
    setError(null);
    try {
      await releaseLiveChatSession(sessionId, myProfileId);
      loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to release chat.");
    } finally {
      setAssistingId(null);
    }
  };

  return (
    <main className="w-full px-4 py-6 lg:px-8">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="inline-flex items-center hover:text-foreground" aria-label="Home" title="Home">
          <Home className="h-3.5 w-3.5" />
        </Link>
        <span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">{mod.label}</Link>
        <span>›</span>
        <span className="text-foreground font-medium">{sub.title}</span>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Live Chat</h1>
          <p className="text-sm text-muted-foreground">Reply to live chat messages from the public website.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              className="glass-input pl-8 w-56"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone, appliance…"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground text-xs font-semibold uppercase">Branch</span>
            <select className="glass-input" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
              <option value="">All</option>
              {LOCATIONS.map((loc) => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {[
          { key: "queue" as const, label: "Queue" },
          { key: "mine" as const, label: "My Chats" },
          { key: "escalated" as const, label: "Escalated" },
          { key: "transferred" as const, label: "Transferred" },
          ...(isWideVisibility ? [{ key: "all" as const, label: "All Teams" }] : isTeamLeader ? [{ key: "team" as const, label: "My Team" }] : []),
        ].map((tab) => {
          const badgeCount =
            tab.key === "escalated"
              ? sessions.filter((s) => s.escalated).length
              : tab.key === "transferred"
              ? sessions.filter((s) => !!s.transferred_from).length
              : 0;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setViewTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                viewTab === tab.key ? "bg-primary/20 text-primary border border-primary/40" : "border border-white/10 bg-white/5 hover:bg-white/10"
              }`}
            >
              {tab.label}
              {badgeCount > 0 && (
                <span
                  className={`grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold text-white ${
                    tab.key === "escalated" ? "bg-red-500/80" : "bg-sky-500/80"
                  }`}
                >
                  {badgeCount}
                </span>
              )}
            </button>
          );
        })}
        <span className="w-px h-5 bg-white/10 mx-1" />
        {(["all", "unread", "read"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setReadFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition ${
              readFilter === f ? "bg-primary/20 text-primary border border-primary/40" : "border border-white/10 bg-white/5 hover:bg-white/10"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">{error}</div>
      )}

      {/* fr-based ranges (not fixed px) so every pane genuinely resizes as
          the browser window does — list/details panes can breathe a little
          wider on a big monitor and shrink toward their floor on a narrower
          one, same as a Messenger-style layout, instead of only the center
          column reacting. */}
      <div
        className={`grid gap-4 ${
          active
            ? "md:grid-cols-[minmax(260px,1fr)_minmax(0,2.4fr)] lg:grid-cols-[minmax(280px,1fr)_minmax(0,2.4fr)_minmax(260px,1fr)]"
            : "md:grid-cols-[minmax(260px,1fr)_minmax(0,3fr)]"
        }`}
      >
        <aside className="rounded-2xl border border-white/15 bg-white/8 backdrop-blur-md overflow-hidden">
          <div className="h-[70vh] overflow-y-auto divide-y divide-white/10">
            {visibleSessions.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                {searchTerm ? "No chats match your search." : branchFilter ? `No chats for ${branchFilter}.` : "No chats yet."}
              </p>
            )}
            {visibleSessions.map((s) => {
              const isUnread = s.unreadCount > 0;
              const online = isRecent(s.visitor_last_seen_at, PRESENCE_RECENCY_MS);
              return (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                onClick={() => setActiveId(s.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveId(s.id);
                  }
                }}
                className={`w-full text-left px-4 py-3 hover:bg-white/10 transition cursor-pointer ${
                  activeId === s.id ? "bg-white/10" : isUnread ? "bg-blue-500/[0.06]" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${online ? "bg-green-400" : "bg-white/15"}`} title={online ? "Online" : "Offline"} />
                    <p className={`text-sm truncate ${isUnread ? "font-bold" : "font-semibold"}`}>{s.visitor_name || "Anonymous visitor"}</p>
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {isUnread && <span className="h-2 w-2 rounded-full bg-blue-500" />}
                    <span className="text-[10px] text-muted-foreground">{formatTimestamp(s.last_message_at)}</span>
                  </span>
                </div>
                {s.visitor_phone && <p className="text-xs text-muted-foreground">{s.visitor_phone}</p>}
                {s.lastMessageBody && (
                  <p className={`text-xs truncate mt-0.5 ${isUnread ? "font-bold text-foreground" : "text-muted-foreground"}`}>
                    {s.lastMessageSender === "staff" ? "You: " : ""}
                    {s.lastMessageBody}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  {s.escalated && (
                    <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300" title="Escalated">
                      <AlertTriangle className="h-3 w-3" /> Escalated
                    </span>
                  )}
                  {s.transferred_from && (
                    <span
                      className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300"
                      title={`Transferred by ${s.transferred_from_name}`}
                    >
                      <ArrowLeftRight className="h-3 w-3" /> Transferred
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground/60">{ticketNumber(s.id)}</span>
                  {s.branch && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">{s.branch}</span>}
                  {isUnread && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500 text-white font-semibold min-w-[1.25rem] text-center">
                      {s.unreadCount}
                    </span>
                  )}
                  {s.status === "closed" && (
                    <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-muted-foreground">
                      <CheckCircle2 className="h-3 w-3" /> Resolved
                    </span>
                  )}
                  {s.status === "open" && (
                    !s.assigned_to ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void handleAssist(s.id); }}
                        disabled={!myProfileId || assistingId === s.id}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-white/15 hover:bg-white/10 transition disabled:opacity-50"
                      >
                        {assistingId === s.id ? "Assisting…" : "Assist"}
                      </button>
                    ) : s.assigned_to === myProfileId ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void handleRelease(s.id); }}
                        disabled={assistingId === s.id}
                        title="Click to release"
                        className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-300 hover:bg-green-500/30 transition disabled:opacity-50"
                      >
                        {assistingId === s.id ? "Releasing…" : "You're assisting"}
                      </button>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">Assisting: {s.assigned_to_name}</span>
                    )
                  )}
                </div>
              </div>
              );
            })}
          </div>
        </aside>

        <section className="rounded-2xl border border-white/15 bg-white/8 backdrop-blur-md flex flex-col h-[70vh]">
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm gap-2">
              <MessageCircle className="h-4 w-4" /> Select a chat to view the conversation
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-white/10">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    {active.visitor_name || "Anonymous visitor"}
                    <span
                      className={`flex items-center gap-1 text-[10px] font-normal px-1.5 py-0.5 rounded-full ${
                        isRecent(active.visitor_last_seen_at, PRESENCE_RECENCY_MS) ? "bg-green-500/15 text-green-300" : "bg-white/10 text-muted-foreground"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${isRecent(active.visitor_last_seen_at, PRESENCE_RECENCY_MS) ? "bg-green-400" : "bg-white/30"}`} />
                      {isRecent(active.visitor_last_seen_at, PRESENCE_RECENCY_MS) ? "Active" : "Away"}
                    </span>
                    {active.escalated && (
                      <span className="flex items-center gap-1 text-[10px] font-normal px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-300">
                        <AlertTriangle className="h-3 w-3" /> Escalated
                      </span>
                    )}
                    {active.transferred_from && (
                      <span
                        className="flex items-center gap-1 text-[10px] font-normal px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-300"
                        title={`Transferred by ${active.transferred_from_name}`}
                      >
                        <ArrowLeftRight className="h-3 w-3" /> Transferred by {active.transferred_from_name}
                      </span>
                    )}
                  </p>
                  {active.status === "closed" && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Resolved
                    </span>
                  )}
                </div>
                {active.visitor_phone && <p className="text-xs text-muted-foreground mt-0.5">{active.visitor_phone}</p>}
                {active.branch && <p className="text-xs text-muted-foreground">{active.branch}</p>}

                {active.status === "open" && (
                  <div className="relative flex items-center gap-1 mt-2 text-xs">
                    <button
                      type="button"
                      onClick={handleResolve}
                      disabled={closing}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition disabled:opacity-50 font-medium"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> {closing ? "Resolving…" : "Resolve"}
                    </button>
                    <span className="w-px h-4 bg-white/10" />
                    <button
                      type="button"
                      onClick={() => setTransferMenuOpen((v) => !v)}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg transition font-medium ${transferMenuOpen ? "bg-white/10" : "hover:bg-white/10"}`}
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5" /> Transfer
                    </button>
                    <span className="w-px h-4 bg-white/10" />
                    <button
                      type="button"
                      onClick={handleEscalateToggle}
                      disabled={escalating}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg transition disabled:opacity-50 font-medium ${
                        active.escalated ? "bg-red-500/15 text-red-300" : "hover:bg-white/10"
                      }`}
                    >
                      <AlertTriangle className="h-3.5 w-3.5" /> {active.escalated ? "Escalated" : "Escalate"}
                    </button>

                    {transferMenuOpen && (
                      <div className="absolute top-full left-0 mt-1 w-56 rounded-lg border border-white/15 bg-slate-900 shadow-xl z-20 max-h-56 overflow-y-auto">
                        {transferCandidates.length === 0 ? (
                          <p className="px-3 py-2 text-xs text-muted-foreground">No one else eligible to transfer to.</p>
                        ) : (
                          transferCandidates.map((u) => (
                            <button
                              key={u.id}
                              type="button"
                              disabled={transferring}
                              onClick={() => {
                                setTransferMenuOpen(false);
                                setPendingTransfer({ id: u.id, name: u.display_name || u.email });
                              }}
                              className="w-full text-left px-3 py-2 text-xs hover:bg-white/10 transition disabled:opacity-50"
                            >
                              {u.display_name || u.email}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {pendingTransfer && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
                  <div className="w-72 rounded-xl border border-white/15 bg-slate-900 p-4 shadow-xl">
                    <p className="text-sm font-semibold flex items-center gap-1.5">
                      <ArrowLeftRight className="h-4 w-4" /> Transfer this chat?
                    </p>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      This chat will be handed to <span className="font-medium text-foreground">{pendingTransfer.name}</span>.
                    </p>
                    <div className="flex items-center justify-end gap-2 mt-4">
                      <button
                        type="button"
                        onClick={() => setPendingTransfer(null)}
                        disabled={transferring}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium border border-white/15 hover:bg-white/10 transition disabled:opacity-50"
                      >
                        No
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!pendingTransfer) return;
                          await handleTransfer(pendingTransfer.id, pendingTransfer.name);
                          setPendingTransfer(null);
                        }}
                        disabled={transferring}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/80 hover:bg-primary transition disabled:opacity-50"
                      >
                        {transferring ? "Transferring…" : "Yes, transfer"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="relative flex-1 min-h-0">
              <div ref={messagesContainerRef} onScroll={handleMessagesScroll} className="h-full overflow-y-auto px-4 py-3 space-y-2">
                {messages.map((m, msgIndex) => {
                  if (m.kind === "callback_request" || m.kind === "appointment_request") {
                    const isCallback = m.kind === "callback_request";
                    const status: "pending" | "accepted" | "declined" = m.request_data?.status ?? "pending";
                    const supersededByNewer = status === "declined" && messages.slice(msgIndex + 1).some((other) => other.kind === m.kind);
                    const label = isCallback
                      ? callbackLabel(m.request_data?.preference, m.request_data?.customTime)
                      : m.request_data?.day === "today"
                      ? "Today"
                      : m.request_data?.day === "tomorrow"
                      ? "Tomorrow"
                      : m.request_data?.date || "Preferred date";
                    const containerClass = isCallback
                      ? "px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs max-w-[85%]"
                      : "px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs max-w-[85%]";
                    const iconClass = isCallback ? "h-3.5 w-3.5 text-blue-300 shrink-0" : "h-3.5 w-3.5 text-amber-300 shrink-0";
                    const titleClass = isCallback ? "font-semibold text-blue-200" : "font-semibold text-amber-200";
                    return (
                      <div key={m.id} className="flex justify-center py-1">
                        <div className={containerClass}>
                          <div className="flex items-center gap-2">
                            {isCallback ? <Phone className={iconClass} /> : <CalendarDays className={iconClass} />}
                            <div>
                              <p className={titleClass}>
                                {isCallback ? "Callback Requested" : "Appointment Requested"}
                                {label ? ` — ${label}` : ""}
                              </p>
                              {isCallback ? (
                                <p className="text-muted-foreground">{formatTimestamp(m.created_at)}</p>
                              ) : (
                                m.request_data?.window && <p className="text-muted-foreground">{m.request_data.window}</p>
                              )}
                            </div>
                          </div>

                          {m.request_data?.note && <p className="mt-1.5 italic text-muted-foreground">"{m.request_data.note}"</p>}

                          {status === "accepted" && (
                            <p className="flex items-center gap-1 mt-1.5 text-green-300 font-medium">
                              <CheckCircle2 className="h-3 w-3" /> Confirmed
                            </p>
                          )}
                          {status === "declined" && (
                            <p className="mt-1.5 text-muted-foreground italic">
                              {supersededByNewer ? "Superseded by a new request below." : "Declined."}
                            </p>
                          )}

                          {status === "pending" && counteringId !== m.id && (
                            <div className="flex items-center gap-2 mt-2">
                              <button
                                type="button"
                                onClick={() => handleAcceptRequest(m)}
                                disabled={respondingId === m.id}
                                className="px-2 py-1 rounded bg-green-500/20 text-green-300 hover:bg-green-500/30 transition disabled:opacity-50 font-medium"
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenCounter(m)}
                                disabled={respondingId === m.id}
                                className="px-2 py-1 rounded border border-white/15 hover:bg-white/10 transition disabled:opacity-50 font-medium"
                              >
                                Suggest Different Time
                              </button>
                            </div>
                          )}

                          {status === "pending" && counteringId === m.id && (
                            <div className="mt-2 space-y-1.5 border-t border-white/10 pt-2">
                              {!isCallback && (
                                <button
                                  type="button"
                                  onClick={handleRecommendCounter}
                                  className="flex items-center gap-1.5 px-2 py-1 rounded border border-purple-500/30 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 transition font-medium"
                                >
                                  <Sparkles className="h-3 w-3" /> Recommend Schedule
                                </button>
                              )}
                              {isCallback
                                ? (["now", "30min", "tomorrow"] as const).map((pref) => (
                                    <label key={pref} className="flex items-center gap-2 cursor-pointer">
                                      <input
                                        type="radio"
                                        name={`counter-callback-${m.id}`}
                                        checked={counterCallbackPreference === pref}
                                        onChange={() => setCounterCallbackPreference(pref)}
                                      />
                                      {CALLBACK_PREFERENCE_LABELS[pref]}
                                    </label>
                                  ))
                                : (["today", "tomorrow", "custom"] as const).map((d) => (
                                    <label key={d} className="flex items-center gap-2 cursor-pointer">
                                      <input type="radio" name={`counter-day-${m.id}`} checked={counterDay === d} onChange={() => setCounterDay(d)} />
                                      {d === "today" ? "Today" : d === "tomorrow" ? "Tomorrow" : "Choose Date"}
                                    </label>
                                  ))}
                              {!isCallback && counterDay === "custom" && (
                                <input type="date" className="glass-input w-full text-xs" value={counterDate} onChange={(e) => setCounterDate(e.target.value)} />
                              )}
                              {!isCallback && (
                                <select className="glass-input w-full text-xs" value={counterWindow} onChange={(e) => setCounterWindow(e.target.value)}>
                                  {APPOINTMENT_WINDOWS.map((w) => (
                                    <option key={w} value={w}>
                                      {w}
                                    </option>
                                  ))}
                                </select>
                              )}
                              <textarea
                                className="glass-input w-full text-xs resize-none"
                                rows={2}
                                placeholder="Optional note — e.g. why the original time doesn't work"
                                value={counterNote}
                                onChange={(e) => setCounterNote(e.target.value)}
                              />
                              <div className="flex items-center gap-2 pt-1">
                                <button type="button" onClick={() => setCounteringId(null)} className="btn text-xs flex-1 justify-center">
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSubmitCounter(m)}
                                  disabled={respondingId === m.id || (!isCallback && counterDay === "custom" && !counterDate)}
                                  className="btn btn-primary text-xs flex-1 justify-center disabled:opacity-50"
                                >
                                  {respondingId === m.id ? "Sending…" : "Send"}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }
                  if (m.kind === "system") {
                    return (
                      <div key={m.id} className="flex justify-center py-1">
                        <p className="text-[11px] text-muted-foreground">{m.body}</p>
                      </div>
                    );
                  }
                  if (m.kind === "internal_note") {
                    return (
                      <div key={m.id} className="flex justify-center py-1">
                        <div className="max-w-[85%] flex items-start gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs">
                          <StickyNote className="h-3.5 w-3.5 text-yellow-300 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-semibold text-yellow-200">
                              Note from {m.sender_name || "Staff"} <span className="font-normal text-muted-foreground">(staff only)</span>
                            </p>
                            <p className="text-foreground/90 mt-0.5">{m.body}</p>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={m.id} className={`flex flex-col ${m.sender === "staff" ? "items-end" : "items-start"}`}>
                      <div className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${m.sender === "staff" ? "bg-blue-600 text-white" : "bg-white/10"}`}>
                        {m.sender === "staff" && m.sender_name && (
                          <p className="text-[10px] font-semibold uppercase text-white/70 mb-0.5">{m.sender_name}</p>
                        )}
                        {m.attachment_url && m.attachment_mime_type?.startsWith("image/") ? (
                          <img src={m.attachment_url} alt={m.attachment_name || "Attached photo"} className="max-w-full rounded-md" />
                        ) : (
                          m.body
                        )}
                      </div>
                      {m.sender === "staff" && (
                        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground mt-0.5 mr-0.5">
                          {m.read_at ? (
                            <CheckCheck className="h-3 w-3 text-blue-400" />
                          ) : m.delivered_at ? (
                            <CheckCheck className="h-3 w-3" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                        </span>
                      )}
                    </div>
                  );
                })}
                {isRecent(active.visitor_typing_at, TYPING_RECENCY_MS) && (
                  <p className="text-xs text-muted-foreground italic">{active.visitor_name || "Visitor"} is typing…</p>
                )}
                <div ref={endRef} />
              </div>
              {newMessageCount > 0 && (
                <button
                  type="button"
                  onClick={scrollToLatest}
                  className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold shadow-lg hover:opacity-90 transition"
                >
                  <ArrowDown className="h-3.5 w-3.5" /> New Messages ({newMessageCount})
                </button>
              )}
              </div>

              {active.status === "closed" ? (
                <p className="px-4 py-3 border-t border-white/10 text-xs text-muted-foreground text-center">This chat has ended.</p>
              ) : !canReplyToActive ? (
                <p className="px-4 py-3 border-t border-white/10 text-xs text-muted-foreground text-center">
                  {active.assigned_to_name} is assisting this chat — you can view but not reply.
                </p>
              ) : (
                <>
                {active.escalated && active.assigned_to && active.assigned_to !== myProfileId && (
                  <p className="px-4 pt-2 text-[11px] text-amber-300/90 text-center">
                    Escalated — {active.assigned_to_name} is assisting, but you can reply too.
                  </p>
                )}
                <div className="relative p-3 border-t border-white/10 flex items-center gap-2">
                  {savedRepliesOpen && (
                    <div className="absolute bottom-full left-3 mb-2 w-80 max-w-[calc(100vw-3rem)] max-h-[28rem] overflow-y-auto rounded-2xl border border-white/15 bg-slate-900 shadow-2xl z-20 flex flex-col">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 sticky top-0 bg-slate-900 rounded-t-2xl">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Saved Replies</p>
                        <button
                          type="button"
                          onClick={() => { setSavedRepliesOpen(false); resetSavedReplyForm(); }}
                          className="p-1 -m-1 rounded text-muted-foreground hover:text-foreground hover:bg-white/10"
                          aria-label="Close saved replies"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {savedReplies.length === 0 ? (
                        <p className="px-4 py-6 text-xs text-muted-foreground text-center">No saved replies yet — add one below.</p>
                      ) : (
                        <div className="p-2 space-y-1">
                          {savedReplies.map((reply) => (
                            <div key={reply.id} className="group flex items-center gap-1 rounded-lg hover:bg-white/5">
                              <button
                                type="button"
                                onClick={() => handleSendSavedReply(reply.body)}
                                disabled={sending}
                                className="flex-1 min-w-0 text-left px-2.5 py-2 rounded-lg disabled:opacity-50"
                              >
                                <p className="text-xs font-semibold text-foreground truncate">{reply.label}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2 leading-snug">{reply.body}</p>
                              </button>
                              <div className="flex items-center gap-0.5 pr-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleEditSavedReply(reply)}
                                  className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-white/10"
                                  aria-label="Edit saved reply"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSavedReply(reply.id)}
                                  className="p-1.5 rounded text-muted-foreground hover:text-red-300 hover:bg-red-500/10"
                                  aria-label="Delete saved reply"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="p-3 border-t border-white/10 bg-black/20 rounded-b-2xl space-y-2">
                        {editingSavedReplyId && (
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary/80">Editing saved reply</p>
                        )}
                        <input
                          value={savedReplyLabel}
                          onChange={(e) => setSavedReplyLabel(e.target.value)}
                          placeholder="Label (e.g. Parts backorder)"
                          className="glass-input w-full text-xs"
                        />
                        <textarea
                          value={savedReplyBody}
                          onChange={(e) => setSavedReplyBody(e.target.value)}
                          placeholder="Reply text"
                          rows={2}
                          className="glass-input w-full text-xs resize-none"
                        />
                        <div className="flex items-center gap-2 pt-0.5">
                          {editingSavedReplyId && (
                            <button type="button" onClick={resetSavedReplyForm} className="btn text-xs flex-1 justify-center">
                              Cancel
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={handleSaveSavedReply}
                            disabled={!savedReplyLabel.trim() || !savedReplyBody.trim() || savingSavedReply}
                            className="btn btn-primary text-xs flex-1 justify-center disabled:opacity-50"
                          >
                            {savingSavedReply ? "Saving…" : editingSavedReplyId ? "Save changes" : "+ Add saved reply"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setSavedRepliesOpen((v) => !v)}
                    className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium transition shrink-0 ${savedRepliesOpen ? "bg-white/10 text-foreground" : "text-muted-foreground hover:bg-white/10 hover:text-foreground"}`}
                    aria-label="Saved replies"
                    title="Saved replies"
                  >
                    <MessageSquareText className="h-4 w-4" />
                    <span className="hidden sm:inline">Saved</span>
                  </button>
                  <input
                    className="glass-input flex-1"
                    value={draft}
                    onChange={(e) => handleDraftChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                    placeholder="Type a reply…"
                    disabled={sending}
                  />
                  <button type="button" onClick={handleSend} disabled={!draft.trim() || sending} className="btn btn-primary p-2 disabled:opacity-50" aria-label="Send reply">
                    <Send className="h-4 w-4" />
                  </button>
                </div>
                </>
              )}
            </>
          )}
        </section>

        {active && (
          <aside className="rounded-2xl border border-white/15 bg-white/8 backdrop-blur-md p-4 space-y-4 h-fit">
            <div>
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Ticket</h3>
              <p className="text-xs text-muted-foreground">{ticketNumber(active.id)}</p>
            </div>

            <div>
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Customer</h3>
              <p className="text-sm font-semibold">{active.visitor_name || "Anonymous visitor"}</p>
              {active.visitor_phone && (
                <button
                  type="button"
                  onClick={() => handleCopyPhone(active.visitor_phone!)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-0.5"
                  title="Click to copy"
                >
                  {phoneCopied ? (
                    <>
                      <Check className="h-3 w-3 text-green-400" /> Copied!
                    </>
                  ) : (
                    <>
                      {active.visitor_phone} <Copy className="h-3 w-3" />
                    </>
                  )}
                </button>
              )}
              {active.branch && <p className="text-xs text-muted-foreground mt-0.5">{active.branch}</p>}
            </div>

            <div>
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Intake</h3>
              {intake.concern || intake.appliance ? (
                <div className="space-y-1 text-xs">
                  {intake.concern && <p><span className="text-muted-foreground">Concern: </span>{intake.concern}</p>}
                  {intake.appliance && <p><span className="text-muted-foreground">Appliance: </span>{intake.appliance}</p>}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No intake details.</p>
              )}
            </div>

            <div>
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Status</h3>
              <div className="flex flex-wrap gap-1.5">
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${active.status === "open" ? "bg-green-500/20 text-green-300" : "bg-white/10 text-muted-foreground"}`}>
                  {active.status === "open" ? "Open" : "Closed"}
                </span>
                {active.assigned_to_name ? (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${active.assigned_to === myProfileId ? "bg-green-500/20 text-green-300" : "bg-amber-500/20 text-amber-300"}`}>
                    {active.assigned_to === myProfileId ? "You're assisting" : active.assigned_to_name}
                  </span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-muted-foreground">Unclaimed</span>
                )}
              </div>
            </div>

            <div>
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Quick Actions</h3>
              <div className="space-y-1">
                {active.visitor_phone ? (
                  <a
                    href={`tel:${active.visitor_phone.replace(/\D/g, "")}`}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-white/10 transition text-xs"
                  >
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" /> Call Customer
                  </a>
                ) : (
                  <p className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground/60">
                    <Phone className="h-3.5 w-3.5" /> No phone on file
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => { setScheduleOpen((v) => !v); setNoteOpen(false); }}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition text-xs ${scheduleOpen ? "bg-white/10" : "hover:bg-white/10"}`}
                >
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" /> Schedule Service
                </button>
                {scheduleOpen && (
                  <div className="ml-2 pl-2.5 border-l border-white/10 space-y-2 py-1">
                    <button
                      type="button"
                      onClick={handleRecommendSchedule}
                      className="flex items-center gap-1.5 px-2 py-1 rounded border border-purple-500/30 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 transition font-medium"
                    >
                      <Sparkles className="h-3 w-3" /> Recommend Schedule
                    </button>
                    {(["today", "tomorrow", "custom"] as const).map((d) => (
                      <label key={d} className="flex items-center gap-2 text-xs cursor-pointer">
                        <input type="radio" name="staff-schedule-day" checked={scheduleDay === d} onChange={() => setScheduleDay(d)} />
                        {d === "today" ? "Today" : d === "tomorrow" ? "Tomorrow" : "Choose Date"}
                      </label>
                    ))}
                    {scheduleDay === "custom" && (
                      <input type="date" className="glass-input w-full text-xs" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} />
                    )}
                    <select className="glass-input w-full text-xs" value={scheduleWindow} onChange={(e) => setScheduleWindow(e.target.value)}>
                      {APPOINTMENT_WINDOWS.map((w) => (
                        <option key={w} value={w}>
                          {w}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleStaffSchedule}
                      disabled={scheduling || (scheduleDay === "custom" && !scheduleDate)}
                      className="btn btn-primary text-xs w-full justify-center disabled:opacity-50"
                    >
                      {scheduling ? "Proposing…" : "Propose"}
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => { setNoteOpen((v) => !v); setScheduleOpen(false); }}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition text-xs ${noteOpen ? "bg-white/10" : "hover:bg-white/10"}`}
                >
                  <StickyNote className="h-3.5 w-3.5 text-muted-foreground" /> Internal Note
                </button>
                {noteOpen && (
                  <div className="ml-2 pl-2.5 border-l border-white/10 space-y-2 py-1">
                    <textarea
                      className="glass-input w-full text-xs resize-none"
                      rows={3}
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="Only visible to staff…"
                    />
                    <button
                      type="button"
                      onClick={handleAddNote}
                      disabled={!noteDraft.trim() || savingNote}
                      className="btn btn-primary text-xs w-full justify-center disabled:opacity-50"
                    >
                      {savingNote ? "Saving…" : "Save Note"}
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleViewAttachments}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-white/10 transition text-xs"
                >
                  <Paperclip className="h-3.5 w-3.5 text-muted-foreground" /> View Attachments{photoMessages.length > 0 ? ` (${photoMessages.length})` : ""}
                </button>
              </div>
            </div>

            <div>
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Started</h3>
              <p className="text-xs text-muted-foreground">{formatTimestamp(active.created_at)}</p>
            </div>

            <div ref={photosRef}>
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Photos {photoMessages.length > 0 ? `(${photoMessages.length})` : ""}</h3>
              {photoMessages.length > 0 ? (
                <div className="grid grid-cols-3 gap-1.5">
                  {photoMessages.map((m) => (
                    <a key={m.id} href={m.attachment_url!} target="_blank" rel="noreferrer">
                      <img src={m.attachment_url!} alt={m.attachment_name || "Photo"} className="h-16 w-full object-cover rounded-md" />
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No attachments yet.</p>
              )}
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}
