/**
 * A stage's approval / rejection note (migration 0376), shown right under
 * that stage's status badge — "Manager: Approved" then the manager's note,
 * "HR: Approved" then HR's note, and so on. Nothing while the stage is
 * still pending or has no note.
 */
export function StageNote({ note, status }: { note: string | null | undefined; status?: string }) {
  const text = (note ?? "").trim();
  if (!text || status === "pending") return null;
  return (
    <p className="max-w-[260px] whitespace-pre-wrap break-words border-l-2 border-white/15 pl-2 text-[11px] italic leading-snug text-slate-400">
      “{text}”
    </p>
  );
}
