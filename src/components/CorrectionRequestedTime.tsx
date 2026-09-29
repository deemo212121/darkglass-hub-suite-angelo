import type { TimecardCorrectionRow } from "@/lib/supabase/timecardCorrections";

type CorrectionTimes = Pick<
  TimecardCorrectionRow,
  | "originalCheckIn" | "originalCheckOut" | "originalMealStart" | "originalMealEnd"
  | "correctedCheckIn" | "correctedCheckOut" | "correctedMealStart" | "correctedMealEnd"
>;

function TimePair({ checkIn, checkOut, mealStart, mealEnd }: { checkIn: string; checkOut: string; mealStart?: string; mealEnd?: string }) {
  const hasMeal = Boolean(mealStart || mealEnd);
  return (
    <div className="whitespace-nowrap">
      <div>{checkIn || "—"} → {checkOut || "—"}</div>
      {hasMeal && (
        <div className="text-[11px] text-slate-400">
          Meal: {mealStart || "—"} → {mealEnd || "—"}
        </div>
      )}
    </div>
  );
}

/** The in/out (and meal, when changed) times a Time Correction asks for. */
export function RequestedTime({ c }: { c: CorrectionTimes }) {
  return <TimePair checkIn={c.correctedCheckIn} checkOut={c.correctedCheckOut} mealStart={c.correctedMealStart} mealEnd={c.correctedMealEnd} />;
}

/** The times actually on the timecard before the correction. */
export function ActualTime({ c }: { c: CorrectionTimes }) {
  return <TimePair checkIn={c.originalCheckIn} checkOut={c.originalCheckOut} mealStart={c.originalMealStart} mealEnd={c.originalMealEnd} />;
}
