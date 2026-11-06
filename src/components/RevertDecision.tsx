/**
 * The Revert buttons, the popup that requires a note, and the "reverted by"
 * lines on a record. Who sees a button comes from decisionRevertRules.ts; the
 * database checks the same rule again when it's used (migration 0429).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Undo2 } from "lucide-react";
import { getDecisionReverts, revertCorrectionStage, revertPtoStage, revertTicketDispute, type DecisionRevert } from "@/lib/supabase/decisionReverts";
import type { TimecardCorrectionRow } from "@/lib/supabase/timecardCorrections";
import { REVERT_STAGE_LABEL, canRevertDecision, statusAfterRevert, type RevertRecordType, type RevertStage } from "@/lib/decisionRevertRules";

const buttonClass =
  "inline-flex items-center gap-1 self-start whitespace-nowrap rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300 transition hover:bg-amber-500/20";

/** One record's reverts, grouped from every revert of this kind. */
export function useDecisionReverts(recordType: RevertRecordType) {
  const [rows, setRows] = useState<DecisionRevert[]>([]);
  const reload = useCallback(() => {
    getDecisionReverts(recordType)
      .then(setRows)
      .catch((err) => console.error("Failed to load reverts:", err));
  }, [recordType]);
  useEffect(reload, [reload]);
  const byRecord = useMemo(() => {
    const map = new Map<string, DecisionRevert[]>();
    for (const r of rows) {
      const list = map.get(r.recordId);
      if (list) list.push(r);
      else map.set(r.recordId, [r]);
    }
    return map;
  }, [rows]);
  return { byRecord, reload };
}

function RevertNoteDialog({
  title,
  message,
  onConfirm,
  onClose,
}: {
  title: string;
  /** What will happen, in plain words. */
  message: string;
  onConfirm: (note: string) => Promise<void>;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const submit = async () => {
    if (!note.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(note.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't revert this.");
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-md rounded-lg border border-white/10 bg-slate-800 p-5 text-left">
        <h3 className="text-base font-bold text-white">{title}</h3>
        <p className="mt-2 text-sm text-slate-300">{message}</p>
        <label className="mt-3 block">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Note *</span>
          <textarea
            autoFocus
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why is this being reverted? The employee sees this."
            className="glass-input mt-1 w-full resize-y rounded-md px-3 py-2 text-sm"
          />
        </label>
        {error && <p className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/5 disabled:opacity-40">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!note.trim() || busy}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
            {busy ? "Reverting…" : "Revert"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

type StageDecision = "pending" | "approved" | "rejected";

interface StagedRecord {
  status: string;
  managerStatus: StageDecision;
  managerReviewedBy: string | null;
  hrStatus: StageDecision;
  hrReviewedBy: string | null;
  accountingStatus: StageDecision;
  accountingReviewedBy: string | null;
}

interface StageButtonProps {
  requesterName: string;
  myProfileId: string | null;
  myName: string;
  isSuperAdmin: boolean;
  onReverted: () => void | Promise<void>;
  className?: string;
}

/** One Revert per step this person may undo on a record with Manager / HR / Accounting steps. */
function StageRevertButtons({
  record,
  requesterName,
  myProfileId,
  isSuperAdmin,
  onReverted,
  className = "flex flex-col gap-1",
  describe,
  revert,
}: StageButtonProps & {
  record: StagedRecord;
  /** What happens, given the record's status once this step is reverted. */
  describe: (after: "pending" | "approved" | "rejected", wasApproved: boolean) => string;
  revert: (stage: RevertStage, note: string) => Promise<unknown>;
}) {
  const [stage, setStage] = useState<RevertStage | null>(null);
  const decisions = { manager: record.managerStatus, hr: record.hrStatus, accounting: record.accountingStatus };
  const deciders = { manager: record.managerReviewedBy, hr: record.hrReviewedBy, accounting: record.accountingReviewedBy };
  const stages = record.status === "cancelled"
    ? []
    : (["manager", "hr", "accounting"] as const).filter((s) => decisions[s] !== "pending" && canRevertDecision(deciders[s], myProfileId, isSuperAdmin));
  if (stages.length === 0) return null;
  const verb = (s: RevertStage) => (decisions[s] === "approved" ? "approval" : "rejection");

  return (
    <div className={className}>
      {stages.map((s) => (
        <button key={s} type="button" onClick={() => setStage(s)} title={`Send the ${REVERT_STAGE_LABEL[s]} ${verb(s)} back to Pending`} className={buttonClass}>
          <Undo2 className="h-3 w-3" /> Revert {REVERT_STAGE_LABEL[s]}
        </button>
      ))}
      {stage && (
        <RevertNoteDialog
          title={`Revert ${REVERT_STAGE_LABEL[stage]} ${verb(stage)}: ${requesterName}`}
          message={describe(statusAfterRevert(decisions, stage), record.status === "approved")}
          onClose={() => setStage(null)}
          onConfirm={async (note) => {
            await revert(stage, note);
            setStage(null);
            await onReverted();
          }}
        />
      )}
    </div>
  );
}

export interface PtoRevertRequest extends StagedRecord {
  id: string;
  profileId: string;
  startDate: string;
  endDate: string;
}

/** Time-Off Management and Exception Reports → SL-UL. */
export function PtoRevertButtons({ request, ...props }: StageButtonProps & { request: PtoRevertRequest }) {
  return (
    <StageRevertButtons
      {...props}
      record={request}
      revert={(stage, note) => revertPtoStage(request, stage, note, { profileId: props.myProfileId, name: props.myName })}
      describe={(after, wasApproved) => {
        if (after === "approved") {
          return wasApproved
            ? "This step goes back to Pending, but the request stays Approved because two other steps still approve it. To take the leave back, another approval has to be reverted too."
            : "This step goes back to Pending, and the request becomes Approved because two other steps already approve it.";
        }
        if (after === "rejected") return "This step goes back to Pending, but the request stays Rejected because another step also rejected it.";
        return wasApproved
          ? "This step goes back to Pending and so does the request. The day stops counting as leave, payroll stops paying it, and its Absent List mark is cleared until it's approved again."
          : "This step goes back to Pending so it can be decided again.";
      }}
    />
  );
}

/** Attendance Monitoring → Corrections and Exception Reports → Time Correction. */
export function CorrectionRevertButtons({ correction, ...props }: StageButtonProps & { correction: TimecardCorrectionRow }) {
  return (
    <StageRevertButtons
      {...props}
      record={correction as StagedRecord}
      revert={(stage, note) => revertCorrectionStage(correction, stage, note, { profileId: props.myProfileId, name: props.myName })}
      describe={(after, wasApproved) => {
        if (after === "approved") {
          return wasApproved
            ? "This step goes back to Pending, but the correction stays Approved because two other steps still approve it, and the timecard keeps the corrected times."
            : "This step goes back to Pending, and the correction becomes Approved because two other steps already approve it. The corrected times go on the timecard.";
        }
        if (after === "rejected") return "This step goes back to Pending, but the correction stays Rejected because another step also rejected it.";
        return wasApproved
          ? "This step goes back to Pending and so does the correction. The timecard goes back to the actual times until it's approved again."
          : "This step goes back to Pending so it can be decided again.";
      }}
    />
  );
}

export interface DisputeRevertRequest {
  id: string;
  profileId: string;
  status: string;
  reviewedBy: string | null;
  ticketNo: string | null;
  originalOnsiteSavedAt?: string | null;
}

export function TicketDisputeRevertButton({
  dispute,
  requesterName,
  myProfileId,
  myName,
  isSuperAdmin,
  onReverted,
}: {
  dispute: DisputeRevertRequest;
  requesterName: string;
  myProfileId: string | null;
  myName: string;
  isSuperAdmin: boolean;
  onReverted: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const decided = dispute.status === "approved" || dispute.status === "rejected";
  if (!decided || !canRevertDecision(dispute.reviewedBy, myProfileId, isSuperAdmin)) return null;
  const approved = dispute.status === "approved";
  const hasTimes = !!dispute.ticketNo;
  const message = !approved
    ? "This dispute goes back to Pending so it can be decided again. The ticket doesn't change."
    : !hasTimes
    ? "This dispute goes back to Pending so it can be decided again."
    : dispute.originalOnsiteSavedAt
    ? "This dispute goes back to Pending, and the ticket's start and end times go back to what they were before it was approved."
    : "This dispute goes back to Pending, but it was approved before the old times were being saved, so the ticket keeps the claimed times. Correct them on the ticket if they're wrong.";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={`Send this ${approved ? "approval" : "rejection"} back to Pending`} className={buttonClass}>
        <Undo2 className="h-3 w-3" /> Revert
      </button>
      {open && (
        <RevertNoteDialog
          title={`Revert ${approved ? "approval" : "rejection"}: ${requesterName}`}
          message={message}
          onClose={() => setOpen(false)}
          onConfirm={async (note) => {
            await revertTicketDispute(dispute, note, { profileId: myProfileId, name: myName });
            setOpen(false);
            await onReverted();
          }}
        />
      )}
    </>
  );
}

/** "Manager approval reverted by Ana on 11/6/2026: wrong dates." */
export function RevertHistory({ entries, className = "" }: { entries: DecisionRevert[] | undefined; className?: string }) {
  if (!entries?.length) return null;
  return (
    <div className={`space-y-0.5 ${className}`}>
      {entries.map((e) => (
        <p key={e.id} className="text-[11px] text-amber-300/90 whitespace-pre-line break-words">
          ↩ {e.stage ? `${REVERT_STAGE_LABEL[e.stage]} ` : ""}
          {e.previousStatus === "approved" ? "approval" : "rejection"} reverted by {e.revertedByName || "someone"} on {new Date(e.createdAt).toLocaleDateString()}: {e.note}
        </p>
      ))}
    </div>
  );
}
