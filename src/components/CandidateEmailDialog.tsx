/**
 * Hiring table → Actions: the Congratulatory and Status Update emails. HR sees
 * and can edit the whole email (From, Recipient, CC, Subject, Body) before it
 * goes, and nothing is sent until they press Send. From is a Hiring Gmail
 * account they connected or one shared with HR (gmailBridge.ts's
 * send-candidate-email). They can pick a signature to go after the sign-off
 * (HiringSignaturePicker). The Congratulatory email can't be sent until its
 * orientation Date and Time are picked.
 */
import { useState } from "react";
import { AlertTriangle, CheckCircle, Loader2, Send } from "lucide-react";
import type { Candidate, CandidateStatus } from "@/lib/supabase/hrCandidates";
import { sendCandidateEmail, type HiringGmailAccount } from "@/lib/supabase/gmailConnection";
import { HiringGmailFromSelect } from "@/components/HiringGmailAccounts";
import { HiringSignaturePicker, rememberSignature, type SignatureChange, type SignatureSelection } from "@/components/HiringSignaturePicker";
import type { CandidateEmailLogEntry } from "@/lib/supabase/hrActivityLog";
import { todayISO } from "@/lib/localDate";
import {
  HIRING_EMAIL_TITLE,
  STATUS_UPDATE_SUBJECT,
  congratsBody,
  congratsSubject,
  greetingName,
  hasUnfilledPlaceholder,
  isValidEmail,
  parseEmailList,
  patchCongratsLines,
  sendableAccounts,
  statusUpdateBody,
  type CongratsFields,
  type HiringEmailKind,
  type OrientationZone,
} from "@/lib/hiringEmails";

const labelClass = "text-[10px] font-semibold text-muted-foreground uppercase tracking-wide";
const inputClass = "glass-input text-sm py-1.5 px-3 rounded-md w-full mt-1";

const STATUSES_AGAINST: Record<HiringEmailKind, CandidateStatus[]> = {
  congratulations: ["rejected", "withdrawn", "cancelled"],
  status_update: ["selected", "training", "hired"],
};
const AGAINST_MEANING: Record<HiringEmailKind, string> = {
  congratulations: "This email tells them they were selected.",
  status_update: "This email tells them they weren't selected.",
};

const sentLine = (e: CandidateEmailLogEntry) =>
  `${HIRING_EMAIL_TITLE[e.kind]} to ${e.to} on ${new Date(e.date).toLocaleDateString()}${e.sentByName ? ` by ${e.sentByName}` : ""}`;

export function CandidateEmailDialog({
  candidate,
  kind,
  statusLabel,
  accounts,
  canManageAll,
  signerName,
  previous,
  onSignatureChanged,
  onClose,
  onSent,
}: {
  candidate: Pick<Candidate, "id" | "name" | "email" | "position" | "status" | "interviewTimezone">;
  kind: HiringEmailKind;
  statusLabel: string;
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
  onSent: (sent: { from: string; to: string; cc: string; subject: string; signature: string }) => void;
}) {
  const name = greetingName(candidate.name);
  const isCongrats = kind === "congratulations";
  const [fields, setFields] = useState<CongratsFields>({
    name,
    position: candidate.position?.trim() ?? "",
    date: "",
    time: "",
    zone: candidate.interviewTimezone ?? "CST",
  });
  const senders = sendableAccounts(accounts ?? []);
  const [accountId, setAccountId] = useState(senders[0]?.id ?? "");
  const from = senders.find((a) => a.id === accountId) ?? senders[0] ?? null;
  const [to, setTo] = useState(candidate.email?.trim() ?? "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(() => (isCongrats ? congratsSubject(fields.position) : STATUS_UPDATE_SUBJECT));
  const [body, setBody] = useState(() => (isCongrats ? congratsBody(fields) : statusUpdateBody(name)));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  // Starts blocked, until the picker has loaded and reported its first choice.
  const [signature, setSignature] = useState<SignatureSelection>({ signatureId: null, signatureName: null, blocked: "Waiting for the signature…" });

  // An untouched draft is rebuilt; one HR has edited keeps their wording and only its Position / Date / Time lines change.
  const updateFields = (patch: Partial<CongratsFields>) => {
    const next = { ...fields, ...patch };
    setFields(next);
    setSubject((cur) => (cur === congratsSubject(fields.position) ? congratsSubject(next.position) : cur));
    setBody((cur) => (cur === congratsBody(fields) ? congratsBody(next) : patchCongratsLines(cur, next)));
  };

  const today = todayISO();
  const ccList = parseEmailList(cc);
  const problem = !from
    ? "Connect your Gmail on the Hiring panel first."
    : signature.blocked
    ? signature.blocked
    : !isValidEmail(to)
    ? "Enter the recipient's email address."
    : ccList.some((a) => !isValidEmail(a))
    ? "Check the CC addresses."
    : isCongrats && !fields.position.trim()
    ? "Enter the position."
    : isCongrats && !fields.date
    ? "Pick the orientation date."
    : isCongrats && fields.date < today
    ? "The orientation date has already passed."
    : isCongrats && !fields.time
    ? "Pick the orientation time."
    : !subject.trim()
    ? "Enter a subject."
    : !body.trim()
    ? "The email body is empty."
    : hasUnfilledPlaceholder(subject) || hasUnfilledPlaceholder(body)
    ? "Fill in the [ ] placeholder left in the email."
    : null;

  const handleSend = async () => {
    if (problem || sending || !from) return;
    setSending(true);
    setError(null);
    try {
      const sent = await sendCandidateEmail({ accountId: from.id, candidateId: candidate.id, to: to.trim(), cc: ccList.join(", "), subject: subject.trim(), body, signatureId: signature.signatureId });
      setSentTo(sent.sentTo);
      rememberSignature(signature.signatureId);
      onSent({ from: sent.sentFrom || from.email, to: sent.sentTo, cc: ccList.join(", "), subject: subject.trim(), signature: signature.signatureName ?? "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send the email.");
    } finally {
      setSending(false);
    }
  };

  const against = STATUSES_AGAINST[kind].includes(candidate.status);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div role="dialog" aria-modal="true" aria-label={`${HIRING_EMAIL_TITLE[kind]} to ${candidate.name}`} className="bg-slate-800 border border-white/10 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h3 className="text-lg font-bold">{HIRING_EMAIL_TITLE[kind]}</h3>
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
            {(against || previous.length > 0) && (
              <div className="mb-4 flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  {against && <p>{candidate.name} is marked {statusLabel}. {AGAINST_MEANING[kind]}</p>}
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

              {isCongrats && (
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1.45fr] gap-3">
                  <label className="block">
                    <span className={labelClass}>Position *</span>
                    <input type="text" value={fields.position} onChange={(e) => updateFields({ position: e.target.value })} className={inputClass} />
                  </label>
                  <label className="block">
                    <span className={labelClass}>Orientation Date *</span>
                    <input type="date" value={fields.date} min={today} onChange={(e) => updateFields({ date: e.target.value })} className={inputClass} />
                  </label>
                  <div>
                    <span className={labelClass}>Orientation Time *</span>
                    <div className="flex gap-1.5">
                      <input type="time" aria-label="Orientation time" value={fields.time} onChange={(e) => updateFields({ time: e.target.value })} className={`${inputClass} min-w-[7.5rem] flex-1`} />
                      <select aria-label="Time zone" value={fields.zone} onChange={(e) => updateFields({ zone: e.target.value as OrientationZone })} className="glass-input text-sm py-1.5 px-2 rounded-md mt-1 !w-[4.5rem] shrink-0">
                        <option value="CST">CST</option>
                        <option value="EST">EST</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              <label className="block">
                <span className={labelClass}>Subject *</span>
                <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} />
              </label>
              <label className="block">
                <span className={labelClass}>Body *</span>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={isCongrats ? 16 : 13} className={`${inputClass} resize-y leading-relaxed`} />
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

/** Opened from the "Congrats sent" / "Status sent" line under a candidate's Actions buttons. */
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
                <span className="font-semibold text-white">{HIRING_EMAIL_TITLE[e.kind]}</span>
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
