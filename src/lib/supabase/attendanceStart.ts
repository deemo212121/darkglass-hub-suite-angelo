/**
 * Loads "Attendance starts on" for a set of employees (see
 * src/lib/attendanceStart.ts for the rule): Master List Hire Date + their HR
 * Hiring training/start date. Viewers who can't read hr_candidates (RLS)
 * just get the Hire Date part — same as before this existed.
 */
import { supabase } from "./client";
import { getEmployeeInfoByProfileIds } from "./users";
import { attendanceStartDate, hiringStartDate, type AttendanceStartCandidate } from "@/lib/attendanceStart";

const PAGE_SIZE = 1000;

/**
 * Every HR Hiring record (paged — a single read stops at 1000 rows, and
 * there are more than that). `extra` adds columns, e.g. created_by.
 */
export async function loadHiringRecords<T extends AttendanceStartCandidate = AttendanceStartCandidate>(extra = ""): Promise<T[]> {
  const readAll = async (columns: string) => {
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase.from("hr_candidates").select(columns).order("id").range(from, from + PAGE_SIZE - 1);
      if (error) return { rows, error };
      rows.push(...((data ?? []) as unknown as T[]));
      if (!data || data.length < PAGE_SIZE) return { rows, error: null };
    }
  };
  const withStart = await readAll(`email, phone, status, training_start_date, start_date${extra}`);
  if (!withStart.error) return withStart.rows;
  // start_date (migration 0261) not there yet — training start only.
  const older = await readAll(`email, phone, status, training_start_date${extra}`);
  return older.error ? [] : older.rows;
}

const loadCandidates = () => loadHiringRecords();

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
