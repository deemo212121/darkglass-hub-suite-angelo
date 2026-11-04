/**
 * The amber "🔔 Remind …" button used on every pending-approval list (Time
 * Corrections, PTO / Leave, Ticket Time Disputes, Truck Stock). After a
 * successful send it reads "Reminded" (time on hover; click to remind again).
 * That mark is per viewer, kept in this browser under `reminderKey` — include
 * the pending steps in the key so a new step shows a fresh "Remind" button.
 */
import { useState } from "react";
import { Bell, BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { ProfileRow } from "@/lib/supabase/users";
import type { ActivityLogModule } from "@/lib/supabase/moduleActivityLog";
import { REMINDER_STAGE_LABEL, remindableStages, remindLabel, resolveRequesterManager, sendApprovalReminder, type ReminderStage } from "@/lib/supabase/approvalReminders";

const STORE = "ahs.approvalReminders";
const KEEP_MS = 60 * 24 * 60 * 60 * 1000; // forget marks after 60 days

function readMarks(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

export function RemindButton({
  reminderKey,
  label,
  title,
  onRemind,
  className = "",
}: {
  reminderKey: string;
  label: string;
  title?: string;
  /** Sends the reminder; resolves to the success message ("Reminder sent to …"). */
  onRemind: () => Promise<string>;
  className?: string;
}) {
  const [sentAt, setSentAt] = useState<number | null>(() => readMarks()[reminderKey] ?? null);
  const [busy, setBusy] = useState(false);
  const click = async () => {
    setBusy(true);
    try {
      const message = await onRemind();
      const now = Date.now();
      setSentAt(now);
      try {
        const marks = readMarks();
        marks[reminderKey] = now;
        for (const [k, t] of Object.entries(marks)) if (now - t > KEEP_MS) delete marks[k];
        localStorage.setItem(STORE, JSON.stringify(marks));
      } catch {
        /* private mode — just not remembered */
      }
      toast.success(message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send the reminder");
    } finally {
      setBusy(false);
    }
  };
  const when = sentAt ? new Date(sentAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
  return (
    <button
      type="button"
      onClick={() => void click()}
      disabled={busy}
      className={`inline-flex items-center gap-1 rounded border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-left text-[11px] font-semibold text-amber-200 hover:bg-amber-500/20 disabled:opacity-50 ${className}`}
      title={when ? `You sent a reminder ${when} — click to remind again` : title ?? "Send a reminder that this is still waiting on approval"}
    >
      {busy ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : sentAt ? <BellRing className="h-3 w-3 shrink-0" /> : <Bell className="h-3 w-3 shrink-0" />}
      {sentAt ? "Reminded" : label}
    </button>
  );
}

/**
 * RemindButton for a staged approval (Time Correction, PTO / Leave, Ticket
 * Time Dispute): reminds whoever holds each step that's still pending, minus
 * the viewer's own step. Renders nothing when there's nobody to remind.
 */
export function StageRemindButton({
  kind,
  id,
  pending,
  requesterId,
  managerId,
  profiles,
  viewer,
  what,
  linkTo,
  logModule,
  className,
}: {
  /** Key prefix + Activity Logs target type, e.g. "timecard_correction". */
  kind: string;
  id: string;
  /** The steps still pending, in order. */
  pending: ReminderStage[];
  requesterId: string;
  managerId?: string | null;
  profiles: readonly ProfileRow[];
  viewer: { id: string | null; name: string | null | undefined; role: string | null | undefined; extraRoles?: readonly (string | null)[] | null };
  what: string;
  linkTo: string;
  logModule: ActivityLogModule;
  className?: string;
}) {
  const manager = pending.includes("manager") ? resolveRequesterManager(requesterId, managerId, profiles) : null;
  const stages = remindableStages(pending, viewer, manager?.id ?? managerId);
  if (stages.length === 0 || !viewer.id) return null;
  return (
    <RemindButton
      reminderKey={`${kind}:${id}:${stages.join("+")}`}
      label={remindLabel(stages)}
      title={`Send ${stages.map((s) => REMINDER_STAGE_LABEL[s]).join(" / ")} a bell reminder that this is still waiting on their approval`}
      className={className}
      onRemind={() =>
        sendApprovalReminder({
          stages,
          requesterId,
          managerId: manager?.id ?? managerId,
          what,
          linkTo,
          senderId: viewer.id || "",
          senderName: viewer.name || "Reviewer",
          log: { module: logModule, targetType: kind, targetId: id },
        })
      }
    />
  );
}
