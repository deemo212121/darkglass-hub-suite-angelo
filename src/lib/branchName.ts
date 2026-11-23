/**
 * The one rule for "is this the same branch?" everywhere in the app.
 *
 * Capitals, spaces, commas and dots never matter, so "Jackson,MS",
 * "Jackson, MS", "jackson ms" and "Jackson , MS" are all one branch.
 *
 * Use it to compare, group or dedupe only. Never show or save the key:
 * show the branch the way it was typed.
 *
 * The database uses the same rule (chain_norm_branch, migration 0474;
 * terms audience, migration 0455), so what the app shows matches what the
 * database allows.
 */
export function branchMatchKey(branch: string | null | undefined): string {
  return String(branch ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** True when both are the same branch (see branchMatchKey). Two blanks are not a match. */
export function sameBranch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = branchMatchKey(a);
  return !!ka && ka === branchMatchKey(b);
}

/** One entry per branch, keeping the first spelling seen, A → Z. Blanks dropped. */
export function uniqueBranches(branches: Iterable<string | null | undefined>): string[] {
  const byKey = new Map<string, string>();
  for (const b of branches) {
    const label = String(b ?? "").trim().replace(/\s*,\s*/g, ", ");
    const key = branchMatchKey(label);
    if (key && !byKey.has(key)) byKey.set(key, label);
  }
  return [...byKey.values()].sort((x, y) => x.localeCompare(y));
}
