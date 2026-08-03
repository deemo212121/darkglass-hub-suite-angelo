/**
 * Public "quick live chat" widget — floating bubble on the landing page.
 * No login, so this never imports the Supabase client: every read/write
 * goes through /api/live-chat (see src/lib/server/liveChatBridge.ts),
 * mirroring the same "plain fetch, no RLS" pattern as ExternalSignDocumentPage.tsx.
 *
 * The session id is kept in sessionStorage so a page refresh mid-chat
 * resumes the same conversation instead of starting a new one. Staff
 * replies arrive via polling (see POLL_INTERVAL_MS) rather than a
 * Supabase Realtime subscription — an anonymous visitor has no session
 * for RLS to safely scope a subscription to just their own chat.
 */
import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, CheckCheck, CheckCircle2, ImagePlus, MessageCircle, Phone, Send, ShieldCheck, X } from "lucide-react";
import { LOCATIONS } from "@/lib/locations";

const CALLBACK_PREFERENCE_LABELS: Record<string, string> = { now: "Now", "30min": "In 30 minutes", tomorrow: "Tomorrow" };
// "custom" has no fixed label — the customer types their own preferred time,
// stored in request_data.customTime — so this falls back to that instead.
function callbackLabel(preference: string | undefined, customTime: string | null | undefined): string {
  if (preference === "custom") return customTime?.trim() || "a custom time";
  return preference ? CALLBACK_PREFERENCE_LABELS[preference] ?? preference : "";
}
// Sent automatically by the bridge (see AUTO_GREETING_SENDER_NAME in
// liveChatBridge.ts) — distinguishes "just the auto-reply" from an actual
// human having replied, for the welcome-card fade-out below.
const AUTO_GREETING_SENDER_NAME = "AHS Support";

const SESSION_STORAGE_KEY = "ahs:liveChatSessionId";
const POLL_INTERVAL_MS = 3000;
// Don't fire a new "typing" ping more than once per this many ms, no matter
// how fast someone types — the recipient's poll only checks every
// POLL_INTERVAL_MS/4s anyway, so anything tighter is wasted traffic.
const TYPING_THROTTLE_MS = 2000;
const PHONE_DIGITS = 10;

// Structured intake instead of a free-text "how can we help" box — gives
// CSRs the two things they need to route a chat before the conversation
// even starts, and keeps the option list short instead of one giant
// per-appliance-repair-type list.
const CONCERN_OPTIONS = [
  "Schedule Repair",
  "Existing Appointment",
  "Warranty Service",
  "Repair Status",
  "Parts Inquiry",
  "Billing Question",
  "General Question",
];

const APPLIANCE_OPTIONS = [
  "Refrigerator",
  "Washer",
  "Dryer",
  "Dishwasher",
  "Oven / Range",
  "Microwave",
  "Freezer",
  "Ice Maker",
  "Air Conditioner",
  "Other",
];

interface ChatMessage {
  id?: string;
  sender: "visitor" | "staff";
  sender_name: string | null;
  body: string;
  kind?: "chat" | "callback_request" | "appointment_request" | "internal_note" | "system";
  request_data?: {
    preference?: string;
    customTime?: string | null;
    day?: string;
    date?: string;
    window?: string;
    note?: string | null;
    status?: "pending" | "accepted" | "declined";
  } | null;
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_mime_type?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
  created_at: string;
}

type Phase = "closed" | "form" | "chat";
type QuickAction = "none" | "callback" | "schedule";

async function postLiveChat(
  action: "start" | "message" | "typing" | "callback" | "schedule" | "respond",
  sessionId: string | null,
  body: Record<string, unknown>
): Promise<Record<string, any>> {
  const params = new URLSearchParams({ action });
  if (sessionId) params.set("sessionId", sessionId);
  const res = await fetch(`/api/live-chat?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

async function uploadLiveChatPhoto(sessionId: string, file: File): Promise<{ url: string; name: string; mimeType: string }> {
  const form = new FormData();
  form.set("file", file);
  const res = await fetch(`/api/live-chat?action=upload&sessionId=${encodeURIComponent(sessionId)}`, { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to upload photo.");
  return data;
}

async function pollLiveChat(sessionId: string): Promise<{ status: string; messages: ChatMessage[]; staffTypingAt: string | null }> {
  const res = await fetch(`/api/live-chat?sessionId=${encodeURIComponent(sessionId)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to load chat.");
  return data;
}

// Formats as the visitor types — caps at 10 digits (US format) and shows
// (000)-000-0000 as digits are added, rather than a raw digit string.
function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)})-${digits.slice(3)}`;
  return `(${digits.slice(0, 3)})-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// Customers see "Agent {first name}" instead of a staff member's full
// name — the auto-greeting's own name ("AHS Support") is left as-is since
// it isn't a person.
function agentDisplayName(name: string | null): string {
  if (!name) return "Agent";
  if (name === "AHS Support") return name;
  return `Agent ${name.trim().split(/\s+/)[0]}`;
}

function isRecent(iso: string | null | undefined, withinMs: number): boolean {
  return !!iso && Date.now() - new Date(iso).getTime() < withinMs;
}

export function LiveChatWidget() {
  const [phase, setPhase] = useState<Phase>("closed");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [branch, setBranch] = useState("");
  const [concern, setConcern] = useState("");
  const [appliance, setAppliance] = useState("");
  const [draft, setDraft] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<"open" | "closed">("open");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [staffTypingAt, setStaffTypingAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quickAction, setQuickAction] = useState<QuickAction>("none");
  const [callbackPreference, setCallbackPreference] = useState<"now" | "30min" | "tomorrow" | "custom">("now");
  const [customCallbackTime, setCustomCallbackTime] = useState("");
  const [scheduleDay, setScheduleDay] = useState<"today" | "tomorrow" | "custom">("today");
  const [scheduleDate, setScheduleDate] = useState("");
  const [requestSending, setRequestSending] = useState(false);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingSentAtRef = useRef(0);

  // Resume an existing session (e.g. after a page refresh) on first mount.
  useEffect(() => {
    const stored = typeof window !== "undefined" ? sessionStorage.getItem(SESSION_STORAGE_KEY) : null;
    if (stored) setSessionId(stored);
  }, []);

  // Poll for new messages / status while a chat is active.
  useEffect(() => {
    if (phase !== "chat" || !sessionId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await pollLiveChat(sessionId);
        if (cancelled) return;
        setMessages(data.messages ?? []);
        setStatus(data.status === "closed" ? "closed" : "open");
        setStaffTypingAt(data.staffTypingAt ?? null);
      } catch {
        // Transient network hiccup — the next poll retries, no need to surface an error for this.
      }
    };
    void tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [phase, sessionId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const handleOpen = () => setPhase(sessionId ? "chat" : "form");

  const isPhoneValid = phone.replace(/\D/g, "").length === PHONE_DIGITS;
  // The auto-greeting doesn't count as "a real reply" — the welcome card
  // stays up (filling what would otherwise be empty space) until an actual
  // human on staff has said something.
  const hasRealStaffReply = messages.some((m) => m.sender === "staff" && m.sender_name !== AUTO_GREETING_SENDER_NAME);

  const handleStartChat = async () => {
    if (!isPhoneValid || !concern || !appliance || sending) return;
    setSending(true);
    setError(null);
    try {
      const trimmedName = name.trim();
      const openingMessage = `Concern: ${concern}\nAppliance: ${appliance}`;
      const { sessionId: newId } = await postLiveChat("start", null, { name: trimmedName, phone: phone.trim(), branch, concern, appliance, message: openingMessage });
      sessionStorage.setItem(SESSION_STORAGE_KEY, newId);
      setSessionId(newId);
      setMessages([{ sender: "visitor", sender_name: trimmedName || null, body: openingMessage, created_at: new Date().toISOString() }]);
      setStatus("open");
      setPhase("chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start chat.");
    } finally {
      setSending(false);
    }
  };

  const handleSend = async () => {
    if (!draft.trim() || !sessionId || sending || status === "closed") return;
    const body = draft.trim();
    setSending(true);
    setError(null);
    try {
      await postLiveChat("message", sessionId, { message: body });
      setMessages((current) => [...current, { sender: "visitor", sender_name: name.trim() || null, body, created_at: new Date().toISOString() }]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message.");
    } finally {
      setSending(false);
    }
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);
    if (!sessionId) return;
    const now = Date.now();
    if (now - lastTypingSentAtRef.current < TYPING_THROTTLE_MS) return;
    lastTypingSentAtRef.current = now;
    postLiveChat("typing", sessionId, {}).catch(() => {});
  };

  const handleAttachPhoto = async (file: File) => {
    if (!sessionId || uploading || status === "closed") return;
    setUploading(true);
    setError(null);
    try {
      const { url, name: fileName, mimeType } = await uploadLiveChatPhoto(sessionId, file);
      setMessages((current) => [
        ...current,
        { sender: "visitor", sender_name: name.trim() || null, body: "📷 Photo", attachment_url: url, attachment_name: fileName, attachment_mime_type: mimeType, created_at: new Date().toISOString() },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload photo.");
    } finally {
      setUploading(false);
    }
  };

  const handleRequestCallback = async () => {
    if (!sessionId || requestSending) return;
    if (callbackPreference === "custom" && !customCallbackTime.trim()) return;
    setRequestSending(true);
    setError(null);
    try {
      const customTime = callbackPreference === "custom" ? customCallbackTime.trim() : undefined;
      await postLiveChat("callback", sessionId, { preference: callbackPreference, customTime });
      setMessages((current) => [
        ...current,
        {
          sender: "visitor",
          sender_name: name.trim() || null,
          kind: "callback_request",
          request_data: { preference: callbackPreference, customTime },
          body: `Requested a callback: ${callbackLabel(callbackPreference, customTime)}`,
          created_at: new Date().toISOString(),
        },
      ]);
      setQuickAction("none");
      setCustomCallbackTime("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request a callback.");
    } finally {
      setRequestSending(false);
    }
  };

  const handleRequestSchedule = async () => {
    if (!sessionId || requestSending) return;
    if (scheduleDay === "custom" && !scheduleDate) return;
    setRequestSending(true);
    setError(null);
    try {
      await postLiveChat("schedule", sessionId, { day: scheduleDay, date: scheduleDay === "custom" ? scheduleDate : undefined });
      const label = scheduleDay === "today" ? "Today" : scheduleDay === "tomorrow" ? "Tomorrow" : scheduleDate;
      setMessages((current) => [
        ...current,
        {
          sender: "visitor",
          sender_name: name.trim() || null,
          kind: "appointment_request",
          request_data: { day: scheduleDay, date: scheduleDate || undefined, window: "9:00 AM - 12:00 PM" },
          body: `Requested to schedule service: ${label}`,
          created_at: new Date().toISOString(),
        },
      ]);
      setQuickAction("none");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request scheduling.");
    } finally {
      setRequestSending(false);
    }
  };

  const handleRespondToRequest = async (m: ChatMessage, responseStatus: "accepted" | "declined") => {
    if (!sessionId || !m.id || respondingId) return;
    setRespondingId(m.id);
    setError(null);
    try {
      await postLiveChat("respond", sessionId, { messageId: m.id, status: responseStatus });
      setMessages((current) =>
        current.map((existing) =>
          existing.id === m.id ? { ...existing, request_data: { ...(existing.request_data ?? {}), status: responseStatus } } : existing
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send your response.");
    } finally {
      setRespondingId(null);
    }
  };

  const handleNewChat = () => {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    setSessionId(null);
    setMessages([]);
    setStatus("open");
    setStaffTypingAt(null);
    setName("");
    setPhone("");
    setBranch("");
    setConcern("");
    setAppliance("");
    setDraft("");
    setError(null);
    setQuickAction("none");
    setCallbackPreference("now");
    setScheduleDay("today");
    setScheduleDate("");
    setPhase("form");
  };

  if (phase === "closed") {
    return (
      <button
        type="button"
        onClick={handleOpen}
        className="fixed bottom-6 right-6 z-40 btn btn-primary h-14 w-14 rounded-full p-0 flex items-center justify-center shadow-xl"
        aria-label="Open live chat"
      >
        <MessageCircle className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-6 right-6 z-40 w-[min(360px,calc(100vw-3rem))] panel p-0 overflow-hidden flex flex-col shadow-2xl"
      style={{ maxHeight: "min(560px, calc(100vh - 3rem))" }}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/10 bg-primary/10 shrink-0">
        <div>
          <p className="text-sm font-semibold">Chat with us</p>
          <p className="text-xs text-muted-foreground">We typically reply in a few minutes.</p>
        </div>
        <button type="button" onClick={() => setPhase("closed")} className="text-muted-foreground hover:text-foreground" aria-label="Minimize chat">
          <X className="h-4 w-4" />
        </button>
      </div>

      {phase === "form" ? (
        <div className="p-4 space-y-3">
          <label className="block text-sm">
            <span className="text-muted-foreground text-xs font-semibold uppercase">Name (optional)</span>
            <input className="glass-input mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground text-xs font-semibold uppercase">Phone Number</span>
            <input
              className="glass-input mt-1 w-full"
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
              placeholder="(000)-000-0000"
              maxLength={14}
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground text-xs font-semibold uppercase">Branch (optional)</span>
            <select className="glass-input mt-1 w-full" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">Select a branch</option>
              {LOCATIONS.map((loc) => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground text-xs font-semibold uppercase">Concern</span>
            <select className="glass-input mt-1 w-full" value={concern} onChange={(e) => setConcern(e.target.value)}>
              <option value="">Select a concern</option>
              {CONCERN_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground text-xs font-semibold uppercase">Appliance</span>
            <select className="glass-input mt-1 w-full" value={appliance} onChange={(e) => setAppliance(e.target.value)}>
              <option value="">Select an appliance</option>
              {APPLIANCE_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            type="button"
            onClick={handleStartChat}
            disabled={!isPhoneValid || !concern || !appliance || sending}
            className="btn btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? "Starting…" : "Start Chat"}
          </button>
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-[240px]">
            <div
              className={`transition-all duration-500 overflow-hidden ${
                hasRealStaffReply ? "opacity-0 max-h-0 mb-0" : "opacity-100 max-h-40 mb-3"
              }`}
            >
              <div className="rounded-lg border border-primary/20 bg-primary/10 p-3">
                <p className="text-sm font-semibold flex items-center gap-1.5">Welcome to AHS Support</p>
                <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                  <li className="flex items-center gap-1.5"><ShieldCheck className="h-3 w-3 text-green-400 shrink-0" /> Average reply: &lt; 2 minutes</li>
                  <li className="flex items-center gap-1.5"><ShieldCheck className="h-3 w-3 text-green-400 shrink-0" /> Upload photos anytime</li>
                  <li className="flex items-center gap-1.5"><ShieldCheck className="h-3 w-3 text-green-400 shrink-0" /> We'll help schedule your repair if needed.</li>
                </ul>
              </div>
            </div>
            {messages.map((m, i) => {
              if (m.kind === "system") {
                return (
                  <div key={i} className="flex justify-center py-1">
                    <p className="text-[11px] text-muted-foreground">{m.body}</p>
                  </div>
                );
              }
              if (m.kind === "callback_request") {
                const label = callbackLabel(m.request_data?.preference, m.request_data?.customTime);
                const reqStatus = m.request_data?.status ?? "pending";
                const awaitingMyResponse = m.sender === "staff" && reqStatus === "pending";
                return (
                  <div key={i} className="flex justify-center py-1">
                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs max-w-[85%]">
                      <Phone className="h-3.5 w-3.5 text-blue-300 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-semibold text-blue-200">Callback requested{label ? ` — ${label}` : ""}</p>
                        {m.request_data?.note && <p className="mt-1 italic text-muted-foreground">"{m.request_data.note}"</p>}
                        {reqStatus === "accepted" && (
                          <p className="flex items-center gap-1 mt-1.5 text-green-300 font-medium">
                            <CheckCircle2 className="h-3 w-3" /> Confirmed
                          </p>
                        )}
                        {reqStatus === "declined" && <p className="mt-1.5 text-muted-foreground italic">Declined.</p>}
                        {awaitingMyResponse && (
                          <div className="flex items-center gap-2 mt-2">
                            <button
                              type="button"
                              onClick={() => handleRespondToRequest(m, "accepted")}
                              disabled={respondingId === m.id}
                              className="px-2 py-1 rounded bg-green-500/20 text-green-300 hover:bg-green-500/30 transition disabled:opacity-50 font-medium"
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRespondToRequest(m, "declined")}
                              disabled={respondingId === m.id}
                              className="px-2 py-1 rounded border border-white/15 hover:bg-white/10 transition disabled:opacity-50 font-medium"
                            >
                              This won't work for me
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }
              if (m.kind === "appointment_request") {
                const day = m.request_data?.day;
                const label = day === "today" ? "Today" : day === "tomorrow" ? "Tomorrow" : m.request_data?.date || "your preferred date";
                const reqStatus = m.request_data?.status ?? "pending";
                const awaitingMyResponse = m.sender === "staff" && reqStatus === "pending";
                return (
                  <div key={i} className="flex justify-center py-1">
                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs max-w-[85%]">
                      <CalendarDays className="h-3.5 w-3.5 text-amber-300 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-semibold text-amber-200">Appointment requested — {label}</p>
                        {m.request_data?.window && <p className="text-muted-foreground mt-0.5">{m.request_data.window}</p>}
                        {m.request_data?.note && <p className="mt-1 italic text-muted-foreground">"{m.request_data.note}"</p>}
                        {reqStatus === "accepted" && (
                          <p className="flex items-center gap-1 mt-1.5 text-green-300 font-medium">
                            <CheckCircle2 className="h-3 w-3" /> Confirmed
                          </p>
                        )}
                        {reqStatus === "declined" && <p className="mt-1.5 text-muted-foreground italic">Declined.</p>}
                        {awaitingMyResponse && (
                          <div className="flex items-center gap-2 mt-2">
                            <button
                              type="button"
                              onClick={() => handleRespondToRequest(m, "accepted")}
                              disabled={respondingId === m.id}
                              className="px-2 py-1 rounded bg-green-500/20 text-green-300 hover:bg-green-500/30 transition disabled:opacity-50 font-medium"
                            >
                              Accept the Schedule
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRespondToRequest(m, "declined")}
                              disabled={respondingId === m.id}
                              className="px-2 py-1 rounded border border-white/15 hover:bg-white/10 transition disabled:opacity-50 font-medium"
                            >
                              This won't work for me
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }
              return (
                <div key={i} className={`flex flex-col ${m.sender === "visitor" ? "items-end" : "items-start"}`}>
                  <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.sender === "visitor" ? "bg-blue-600 text-white" : "bg-white/10"}`}>
                    {m.sender === "staff" && m.sender_name && (
                      <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-0.5">{agentDisplayName(m.sender_name)}</p>
                    )}
                    {m.attachment_url && m.attachment_mime_type?.startsWith("image/") ? (
                      <img src={m.attachment_url} alt={m.attachment_name || "Attached photo"} className="max-w-full rounded-md" />
                    ) : (
                      m.body
                    )}
                  </div>
                  {m.sender === "visitor" && (
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
            {isRecent(staffTypingAt, POLL_INTERVAL_MS + 4000) && (
              <p className="text-xs text-muted-foreground italic">Support is typing…</p>
            )}
          </div>
          {status === "closed" ? (
            <div className="p-4 border-t border-white/10 space-y-2 shrink-0">
              <p className="text-xs text-muted-foreground text-center">This chat has ended.</p>
              <button type="button" onClick={handleNewChat} className="btn w-full justify-center">Start a new chat</button>
            </div>
          ) : (
            <div className="border-t border-white/10 shrink-0">
              {quickAction === "none" ? (
                <div className="flex items-center gap-2 px-3 pt-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setQuickAction("callback")}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-white/15 hover:bg-white/10 transition"
                  >
                    <Phone className="h-3.5 w-3.5" /> Request Callback
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuickAction("schedule")}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-white/15 hover:bg-white/10 transition"
                  >
                    <CalendarDays className="h-3.5 w-3.5" /> Schedule Service
                  </button>
                </div>
              ) : quickAction === "callback" ? (
                <div className="px-3 pt-2 space-y-2">
                  <p className="text-xs font-semibold">Would you like us to call you?</p>
                  {(["now", "30min", "tomorrow"] as const).map((pref) => (
                    <label key={pref} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="radio" name="callback-preference" checked={callbackPreference === pref} onChange={() => setCallbackPreference(pref)} />
                      {CALLBACK_PREFERENCE_LABELS[pref]}
                    </label>
                  ))}
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="radio" name="callback-preference" checked={callbackPreference === "custom"} onChange={() => setCallbackPreference("custom")} />
                    Custom time
                  </label>
                  {callbackPreference === "custom" && (
                    <input
                      type="text"
                      value={customCallbackTime}
                      onChange={(e) => setCustomCallbackTime(e.target.value)}
                      placeholder="e.g. Friday around 2 PM"
                      maxLength={100}
                      className="w-full rounded-md bg-white/10 border border-white/15 px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                    />
                  )}
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setQuickAction("none")} className="btn text-xs flex-1 justify-center">Cancel</button>
                    <button
                      type="button"
                      onClick={handleRequestCallback}
                      disabled={requestSending || (callbackPreference === "custom" && !customCallbackTime.trim())}
                      className="btn btn-primary text-xs flex-1 justify-center disabled:opacity-50"
                    >
                      {requestSending ? "Confirming…" : "Confirm"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="px-3 pt-2 space-y-2">
                  <p className="text-xs font-semibold">Select preferred day</p>
                  {(["today", "tomorrow", "custom"] as const).map((d) => (
                    <label key={d} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="radio" name="schedule-day" checked={scheduleDay === d} onChange={() => setScheduleDay(d)} />
                      {d === "today" ? "Today" : d === "tomorrow" ? "Tomorrow" : "Choose Date"}
                    </label>
                  ))}
                  {scheduleDay === "custom" && (
                    <input type="date" className="glass-input w-full text-xs" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} />
                  )}
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setQuickAction("none")} className="btn text-xs flex-1 justify-center">Cancel</button>
                    <button
                      type="button"
                      onClick={handleRequestSchedule}
                      disabled={requestSending || (scheduleDay === "custom" && !scheduleDate)}
                      className="btn btn-primary text-xs flex-1 justify-center disabled:opacity-50"
                    >
                      {requestSending ? "Confirming…" : "Confirm"}
                    </button>
                  </div>
                </div>
              )}
              <div className="p-3">
              {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void handleAttachPhoto(file);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="btn p-2 shrink-0 disabled:opacity-50"
                  aria-label="Attach a photo"
                  title="Attach a photo — appliance, model sticker, error code, damaged part, or leak"
                >
                  <ImagePlus className="h-4 w-4" />
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
                  placeholder="Type a message…"
                  disabled={sending}
                />
                <button type="button" onClick={handleSend} disabled={!draft.trim() || sending} className="btn btn-primary p-2 disabled:opacity-50" aria-label="Send message">
                  <Send className="h-4 w-4" />
                </button>
              </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
