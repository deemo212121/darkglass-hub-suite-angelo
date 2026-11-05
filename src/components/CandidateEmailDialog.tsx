/**
 * Hiring table → Actions: the email menu and window. HR picks one of the emails
 * in lib/hiringEmails.ts, sees it filled in with everything the app knows, and
 * can edit all of it (From, Recipient, CC, the details, Subject, Body) before it
 * goes. Nothing is sent until they press Send. From is a Hiring Gmail account
 * they connected or one shared with HR (gmailBridge.ts's send-candidate-email),
 * and they can pick a signature to go after the sign-off (HiringSignaturePicker).
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle, Loader2, Mail, Send } from "lucide-react";
import type { Candidate, CandidateStatus } from "@/lib/supabase/hrCandidates";
import { sendCandidateEmail, type HiringGmailAccount } from "@/lib/supabase/gmailConnection";
import { HiringGmailFromSelect } from "@/components/HiringGmailAccounts";
import { HiringSignaturePicker, rememberSignature, type SignatureChange, type SignatureSelection } from "@/components/HiringSignaturePicker";
import type { CandidateEmailLogEntry } from "@/lib/supabase/hrActivityLog";
import { todayISO } from "@/lib/localDate";
import {
  HIRING_EMAIL_KINDS,
  HIRING_EMAIL_TEMPLATES,
  carryFieldChanges,
  emailFieldProblem,
  hasUnfilledPlaceholder,
  isTechnicianPosition,
  isValidEmail,
  normalizeLink,
  parseEmailList,
  sendableAccounts,
  type EmailFields,
  type EmailFieldKey,
  type HiringEmailKind,
  type OrientationZone,
} from "@/lib/hiringEmails";

const labelClass = "text-[10px] font-semibold text-muted-foreground uppercase tracking-wide";
const inputClass = "glass-input text-sm py-1.5 px-3 rounded-md w-full mt-1";

// Statuses that contradict what the email tells them.
const STOPPED: CandidateStatus[] = ["rejected", "withdrawn", "cancelled"];
const STATUSES_AGAINST: Record<HiringEmailKind, { statuses: CandidateStatus[]; meaning: string }> = {
  screening_passed: { statuses: STOPPED, meaning: "This email invites them to the next interview." },
  interview_reminder: { statuses: STOPPED, meaning: "This email reminds them about an interview." },
  congratulations: { statuses: STOPPED, meaning: "This email tells them they were selected." },
  congratulations_technician: { statuses: STOPPED, meaning: "This email tells them they were selected." },
  status_update: { statuses: ["selected", "training", "hired"], meaning: "This email tells them they weren't selected." },
};

const sentLine = (e: CandidateEmailLogEntry) =>
  `${HIRING_EMAIL_TEMPLATES[e.kind].title} to ${e.to} on ${new Date(e.date).toLocaleDateString()}${e.sentByName ? ` by ${e.sentByName}` : ""}`;

export function CandidateEmailDialog({
  candidate,
  kind,
  statusLabel,
  prefill,
  accounts,
  canManageAll,
  signerName,
  previous,
  onSignatureChanged,
  onClose,
  onSent,
}: {
  candidate: Pick<Candidate, "id" | "name" | "email" | "position" | "status">;
  kind: HiringEmailKind;
  statusLabel: string;
  /** What the app already knows (prefillEmailFields). */
  prefill: EmailFields;
  /** Every connected Hiring Gmail; null if migration 0428 hasn't been run. */
  accounts: HiringGmailAccount[] | null;
  /** Admin / Super Admin: can share or remove anyone's signature. */
  canManageAll: boolean;
  /** Who's sending: starts the name box when they upload a signature. */
  signerName: string;
  /** Emails already sent to this candidate, newest first. */
  previous: CandidateEmailLogEntry[];
  onSignatureChanged: (change: SignatureChange) => void;
  onClose: () => void;
  onSent: (sent: { from: string; to: string; cc: string; subject: string; signature: string; discordLink: string }) => void;
}) {
  const template = HIRING_EMAIL_TEMPLATES[kind];
  const has = (key: EmailFieldKey) => template.fields.includes(key);
  const today = todayISO();
  const [fields, setFields] = useState<EmailFields>(prefill);
  const senders = sendableAccounts(accounts ?? []);
  const [accountId, setAccountId] = useState(senders[0]?.id ?? "");
  const from = senders.find((a) => a.id === accountId) ?? senders[0] ?? null;
  const [to, setTo] = useState(candidate.email?.trim() ?? "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(() => template.subject(prefill, today));
  const [body, setBody] = useState(() => template.body(prefill, today));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  // Starts blocked, until the picker has loaded and reported its first choice.
  const [signature, setSignature] = useState<SignatureSelection>({ signatureId: null, signatureName: null, blocked: "Waiting for the signature…" });

  const updateFields = (patch: Partial<EmailFields>) => {
    const next = { ...fields, ...patch };
    setFields(next);
    setSubject((cur) => (cur === template.subject(fields, today) ? template.subject(next, today) : cur));
    setBody((cur) => carryFieldChanges(cur, template.body(fields, today), template.body(next, today)));
  };

  const ccList = parseEmailList(cc);
  const problem = !from
    ? "Connect your Gmail on the Hiring panel first."
    : signature.blocked
    ? signature.blocked
    : !isValidEmail(to)
    ? "Enter the recipient's email address."
    : ccList.some((a) => !isValidEmail(a))
    ? "Check the CC addresses."
    : emailFieldProblem(kind, fields, today)
    ?? (!subject.trim()
    ? "Enter a subject."
    : !body.trim()
    ? "The email body is empty."
    : hasUnfilledPlaceholder(subject) || hasUnfilledPlaceholder(body)
    ? "Fill in the [ ] placeholder left in the email."
    : null);

  const handleSend = async () => {
    if (problem || sending || !from) return;
    setSending(true);
    setError(null);
    try {
      const sent = await sendCandidateEmail({ accountId: from.id, candidateId: candidate.id, to: to.trim(), cc: ccList.join(", "), subject: subject.trim(), body, signatureId: signature.signatureId });
      setSentTo(sent.sentTo);
      rememberSignature(signature.signatureId);
      onSent({
        from: sent.sentFrom || from.email,
        to: sent.sentTo,
        cc: ccList.join(", "),
        subject: subject.trim(),
        signature: signature.signatureName ?? "",
        discordLink: has("discordLink") ? normalizeLink(fields.discordLink) : "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send the email.");
    } finally {
      setSending(false);
    }
  };

  const against = STATUSES_AGAINST[kind].statuses.includes(candidate.status);
  // Only when the position says otherwise; a blank position has nothing to compare.
  const wrongTemplate =
    !!candidate.position?.trim() &&
    ((kind === "congratulations_technician" && !isTechnicianPosition(candidate.position)) || (kind === "congratulations" && isTechnicianPosition(candidate.position)));

  const textField = (key: "location" | "contactPerson" | "contactNumber" | "username" | "password" | "discordLink", label: string, placeholder?: string) => (
    <label className="block">
      <span className={labelClass}>{label} *</span>
      <input type="text" autoComplete="off" value={fields[key]} onChange={(e) => updateFields({ [key]: e.target.value })} placeholder={placeholder} className={inputClass} />
    </label>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div role="dialog" aria-modal="true" aria-label={`${template.title} to ${candidate.name}`} className="bg-slate-800 border border-white/10 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h3 className="text-lg font-bold">{template.title}</h3>
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-white">{candidate.name}</span>
              {candidate.position ? ` · ${candidate.position}` : ""} · {statusLabel}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-white text-lg leading-none" aria-label="Close">×</button>
        </div>

        {sentTo ? (
          <>
            <p className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-3 text-sm text-green-200">
              <CheckCircle className="h-4 w-4 shrink-0" /> Email sent to {sentTo}.
            </p>
            <div className="flex justify-end mt-4">
              <button type="button" autoFocus onClick={onClose} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Close</button>
            </div>
          </>
        ) : (
          <>
            {(against || wrongTemplate || previous.length > 0) && (
              <div className="mb-4 flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  {against && <p>{candidate.name} is marked {statusLabel}. {STATUSES_AGAINST[kind].meaning}</p>}
                  {wrongTemplate && <p>{candidate.name}'s position is {candidate.position}, but this is the {kind === "congratulations" ? "Non-Technician" : "Technician"} email.</p>}
                  {previous.map((e, i) => <p key={i}>Already sent: {sentLine(e)}.</p>)}
                </div>
              </div>
            )}

            <div className="space-y-3">
              <label className="block">
                <span className={labelClass}>From *</span>
                <HiringGmailFromSelect accounts={senders} value={from?.id ?? ""} onChange={setAccountId} className={inputClass} />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className={labelClass}>Recipient *</span>
                  <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" className={inputClass} />
                </label>
                <label className="block">
                  <span className={labelClass}>CC</span>
                  <input type="text" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Separate addresses with commas" className={inputClass} />
                </label>
              </div>

              {has("date") && (
                <div className={`grid grid-cols-1 gap-3 ${has("position") ? "sm:grid-cols-[1fr_1fr_1.45fr]" : "sm:grid-cols-[1fr_1.45fr]"}`}>
                  {has("position") && (
                    <label className="block">
                      <span className={labelClass}>Position *</span>
                      <input type="text" value={fields.position} onChange={(e) => updateFields({ position: e.target.value })} className={inputClass} />
                    </label>
                  )}
                  <label className="block">
                    <span className={labelClass}>{template.dateWord} Date *</span>
                    <input type="date" value={fields.date} min={today} onChange={(e) => updateFields({ date: e.target.value })} className={inputClass} />
                  </label>
                  <div>
                    <span className={labelClass}>{template.dateWord} Time *</span>
                    <div className="flex gap-1.5">
                      <input type="time" aria-label={`${template.dateWord} time`} value={fields.time} onChange={(e) => updateFields({ time: e.target.value })} className={`${inputClass} min-w-[7.5rem] flex-1`} />
                      <select aria-label="Time zone" value={fields.zone} onChange={(e) => updateFields({ zone: e.target.value as OrientationZone })} className="glass-input text-sm py-1.5 px-2 rounded-md mt-1 !w-[4.5rem] shrink-0">
                        <option value="CST">CST</option>
                        <option value="EST">EST</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {has("location") && textField("location", "Location")}
              {has("contactPerson") && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {textField("contactPerson", "Contact Person")}
                  {textField("contactNumber", "Contact Number")}
                </div>
              )}
              {has("username") && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {textField("username", "Username", "John.Smith")}
                  {textField("password", "Password")}
                </div>
              )}
              {has("discordLink") && textField("discordLink", "Discord Link", "https://discord.gg/...")}

              <label className="block">
                <span className={labelClass}>Subject *</span>
                <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} />
              </label>
              <label className="block">
                <span className={labelClass}>Body *</span>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={has("date") ? 16 : 13} className={`${inputClass} resize-y leading-relaxed`} />
              </label>

              <HiringSignaturePicker signerName={signerName} canManageAll={canManageAll} onSelectionChange={setSignature} onChanged={onSignatureChanged} />
            </div>

            {error && <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>}

            <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
              <p className="text-xs text-amber-300">{problem}</p>
              <div className="flex gap-2 ml-auto">
                <button type="button" onClick={onClose} disabled={sending} className="rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/5 disabled:opacity-40">Cancel</button>
                <button type="button" onClick={handleSend} disabled={!!problem || sending} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The Actions column's email button: one menu of every email, opened over the table so its scrolling can't cut it off. */
export function CandidateEmailMenu({ candidateName, onPick }: { candidateName: string; onPick: (kind: HiringEmailKind) => void }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const WIDTH = 272;
  const HEIGHT = 8 + HIRING_EMAIL_KINDS.length * 34;
  const isOpen = !!pos;

  useEffect(() => {
    if (!isOpen) return;
    const close = () => setPos(null);
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    menuRef.current?.querySelector("button")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [isOpen]);

  const toggle = () => {
    if (pos) return setPos(null);
    const r = buttonRef.current!.getBoundingClientRect();
    setPos({
      top: r.bottom + 4 + HEIGHT > window.innerHeight ? Math.max(4, r.top - HEIGHT - 4) : r.bottom + 4,
      left: Math.max(4, Math.min(r.left, window.innerWidth - WIDTH - 4)),
    });
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        title="Email this candidate"
        aria-label={`Email ${candidateName}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="btn text-emerald-400 hover:text-emerald-300 text-sm p-1"
      >
        <Mail className="h-4 w-4" />
      </button>
      {pos &&
        createPortal(
          <div ref={menuRef} role="menu" aria-label={`Email ${candidateName}`} style={{ position: "fixed", top: pos.top, left: pos.left, width: WIDTH }} className="z-50 rounded-lg border border-white/10 bg-slate-800 p-1 shadow-xl">
            {HIRING_EMAIL_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                role="menuitem"
                onClick={() => { setPos(null); onPick(kind); }}
                className="block w-full rounded-md px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-white/10 focus:bg-white/10 focus:outline-none"
              >
                {HIRING_EMAIL_TEMPLATES[kind].menuLabel}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

const SENT_LINE_COLOR: Record<HiringEmailKind, string> = {
  screening_passed: "text-sky-400 hover:text-sky-300",
  interview_reminder: "text-sky-400 hover:text-sky-300",
  congratulations: "text-emerald-400 hover:text-emerald-300",
  congratulations_technician: "text-emerald-400 hover:text-emerald-300",
  status_update: "text-amber-400 hover:text-amber-300",
};

/** One "Congrats sent 11/5/2026" line per kind of email this candidate has had. */
export function CandidateEmailSentLines({ entries, onOpen }: { entries: CandidateEmailLogEntry[]; onOpen: () => void }) {
  return (
    <>
      {HIRING_EMAIL_KINDS.map((kind) => {
        const last = entries.find((e) => e.kind === kind);
        if (!last) return null;
        return (
          <button key={kind} type="button" onClick={onOpen} title="Click to see what was sent" className={`block mt-1 text-[10px] font-medium hover:underline whitespace-nowrap ${SENT_LINE_COLOR[kind]}`}>
            {HIRING_EMAIL_TEMPLATES[kind].short} sent {new Date(last.date).toLocaleDateString()}
          </button>
        );
      })}
    </>
  );
}

/** Opened from a sent line under a candidate's Actions buttons. */
export function CandidateEmailHistoryDialog({ candidateName, entries, onClose }: { candidateName: string; entries: CandidateEmailLogEntry[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Emails sent to ${candidateName}`} className="bg-slate-800 border border-white/10 rounded-lg p-6 max-w-lg w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold">{candidateName} — Emails Sent</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-white text-lg leading-none" aria-label="Close">×</button>
        </div>
        <ul className="space-y-2">
          {entries.map((e, i) => (
            <li key={i} className="text-sm border border-white/10 rounded-md px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-white">{HIRING_EMAIL_TEMPLATES[e.kind].title}</span>
                <span className="text-muted-foreground text-xs whitespace-nowrap">{new Date(e.date).toLocaleString()}</span>
              </div>
              {e.from && <p className="mt-1 text-xs text-muted-foreground break-words">From: {e.from}</p>}
              <p className={`${e.from ? "" : "mt-1 "}text-xs text-muted-foreground break-words`}>To: {e.to}{e.cc ? ` · CC: ${e.cc}` : ""}</p>
              <p className="text-xs text-muted-foreground break-words">Subject: {e.subject}</p>
              {e.signature && <p className="text-xs text-muted-foreground break-words">Signature: {e.signature}</p>}
              {e.sentByName && <p className="text-xs text-muted-foreground">Sent by {e.sentByName}</p>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
