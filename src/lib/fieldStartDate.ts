interface FieldStartCandidate {
  email: string | null;
  phone: string | null;
  training_start_date: string | null;
  training_end_date: string | null;
}

/** Match HR's phone-linked training record before falling back to account email. */
export function resolveTrainingRecord(
  profile: { email: string | null; phone_number: string | null; training_end_date: string | null },
  candidates: FieldStartCandidate[],
): FieldStartCandidate | null {
  const normalizePhone = (value: string | null) => {
    const digits = (value ?? "").replace(/\D/g, "");
    return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  };
  const phone = normalizePhone(profile.phone_number);
  const email = profile.email?.trim().toLowerCase();
  const phoneMatches = phone ? candidates.filter((c) => normalizePhone(c.phone) === phone) : [];
  const matches = phoneMatches.length ? phoneMatches
    : email ? candidates.filter((c) => c.email?.trim().toLowerCase() === email) : [];
  matches.sort((a, b) => (b.training_start_date ?? "").localeCompare(a.training_start_date ?? ""));
  return matches[0] ?? null;
}

export function resolveFieldStartDate(
  profile: { email: string | null; phone_number: string | null; training_end_date: string | null },
  candidates: FieldStartCandidate[],
): string | null {
  return resolveTrainingRecord(profile, candidates)?.training_end_date || profile.training_end_date || null;
}

export function trainingWindow(start: string | null | undefined, fieldStart: string | null | undefined,
  hireDate: string | null | undefined, manualEnd: string | null | undefined) {
  if (start && fieldStart && fieldStart >= start) {
    const end = new Date(`${fieldStart}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() - 1);
    return { start, end: end.toISOString().slice(0, 10), source: "hr" as const };
  }
  return { start: hireDate || null, end: manualEnd || null, source: "manual" as const };
}

/** The trainee minimum absorbs OT; a trainee day's base pay is topped up once. */
export function isTrainingDay(date: string, window: { start: string | null; end: string | null }): boolean {
  return !!window.end && date <= window.end && (!window.start || date >= window.start);
}
