/**
 * Loads "Attendance starts on" for a set of employees (see
 * src/lib/attendanceStart.ts for the rule): Master List Hire Date + their HR
 * Hiring training/start date. Viewers who can't read hr_candidates (RLS)
 * just get the Hire Date part — same as before this existed.
 */
import { supabase } from "./client";
import { getEmployeeInfoByProfileIds } from "./users";
import { attendanceStartDate, hiringStartDate, type AttendanceStartCandidate } from "@/lib/attendanceStart";

async function loadCandidates(): Promise<AttendanceStartCandidate[]> {
  const withStart = await supabase.from("hr_candidates").select("email, phone, status, training_start_date, start_date");
  if (!withStart.error) return (withStart.data ?? []) as AttendanceStartCandidate[];
  // start_date (migration 0261) not there yet — training start only.
  const older = await supabase.from("hr_candidates").select("email, phone, status, training_start_date");
  return older.error ? [] : ((older.data ?? []) as AttendanceStartCandidate[]);
}

export async function getAttendanceStartByProfile(
  profiles: { id: string; email: string | null; phone_number?: string | null }[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (profiles.length === 0) return out;
  const [infoMap, candidates] = await Promise.all([
    getEmployeeInfoByProfileIds(profiles.map((p) => p.id)).catch(() => new Map()),
    loadCandidates().catch(() => [] as AttendanceStartCandidate[]),
  ]);
  for (const p of profiles) {
    const start = attendanceStartDate(infoMap.get(p.id)?.hireDate ?? null, hiringStartDate(p, candidates));
    if (start) out.set(p.id, start);
  }
  return out;
}
