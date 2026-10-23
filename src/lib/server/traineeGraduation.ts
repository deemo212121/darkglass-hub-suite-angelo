/**
 * Trainee → Regular on the Field Start day, from the hourly cron — so it
 * happens even when nobody opens HR → Training List (which does the same
 * check whenever it loads; see TrainingListPage.tsx's "Day-reached
 * auto-graduation").
 *
 * A trainee (profiles.employment_type = 'trainee') whose Field Start has
 * been reached — their own profiles.training_end_date, else the
 * hr_candidates record matched by phone, then email, in the same company —
 * is set to 'regular'. Field Start is judged by today's date in Central
 * time. Idempotent: someone already Regular is never touched.
 */
import { DEFAULT_ATTENDANCE_TIMEZONE, nowInTimezone } from "../attendanceGrace";

interface Summary {
  today: string;
  trainees: number;
  graduated: string[];
  errors: string[];
}

const normalizePhone = (v: string | null | undefined) => (v || "").replace(/\D/g, "");
const normalizeEmail = (v: string | null | undefined) => (v || "").trim().toLowerCase();
const personKeys = (companyId: string, phone: string | null | undefined, email: string | null | undefined) => {
  const keys: string[] = [];
  const ph = normalizePhone(phone);
  const em = normalizeEmail(email);
  if (ph) keys.push(`${companyId}|phone:${ph}`);
  if (em) keys.push(`${companyId}|email:${em}`);
  return keys;
};

export async function runTraineeGraduation(env: Record<string, string | undefined>): Promise<Summary> {
  const today = nowInTimezone(DEFAULT_ATTENDANCE_TIMEZONE).dateISO;
  const summary: Summary = { today, trainees: 0, graduated: [], errors: [] };

  const g = globalThis as any;
  const supabaseUrl = (g.__SUPABASE_URL__ || undefined) ?? env.VITE_SUPABASE_URL;
  const serviceKey = (g.__SUPABASE_SERVICE_KEY__ || undefined) ?? env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    summary.errors.push("Missing Supabase URL/service key.");
    return summary;
  }
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const get = async <T,>(path: string): Promise<T[]> => {
    const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers });
    if (!res.ok) throw new Error(`${path.split("?")[0]}: HTTP ${res.status}`);
    return res.json();
  };

  type Profile = { id: string; company_id: string; display_name: string | null; email: string | null; phone_number: string | null; training_end_date: string | null };
  const trainees = await get<Profile>("profiles?select=id,company_id,display_name,email,phone_number,training_end_date&employment_type=eq.trainee");
  summary.trainees = trainees.length;
  if (trainees.length === 0) return summary;

  // Field Start from HR's hiring record, for trainees with none on their own profile.
  const candidateEnd = new Map<string, string>();
  const candidates = await get<{ company_id: string; phone: string | null; email: string | null; training_end_date: string | null }>(
    "hr_candidates?select=company_id,phone,email,training_end_date&training_end_date=not.is.null",
  ).catch((err) => {
    summary.errors.push(`hr_candidates: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  });
  for (const c of candidates) {
    if (!c.training_end_date) continue;
    for (const k of personKeys(c.company_id, c.phone, c.email)) candidateEnd.set(k, c.training_end_date);
  }

  for (const p of trainees) {
    const fieldStart = p.training_end_date || personKeys(p.company_id, p.phone_number, p.email).map((k) => candidateEnd.get(k)).find(Boolean);
    if (!fieldStart || fieldStart > today) continue;
    const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${p.id}&employment_type=eq.trainee`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ employment_type: "regular" }),
    });
    if (res.ok) summary.graduated.push(`${p.display_name || p.id} (Field Start ${fieldStart})`);
    else summary.errors.push(`${p.display_name || p.id}: HTTP ${res.status}`);
  }
  return summary;
}
