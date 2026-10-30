/**
 * Matching a technician's name from an outside sheet (ER exports, the ER
 * tracking sheet, HR's spreadsheets) to their AHS account. Those sheets
 * spell people a little differently from the account: "Adejaun Tyson" for
 * A'Dejaun Tyson, "Erick Guzman Juarez" for Erick Guzman, ER's "Josh
 * Malloch" for Joshua Malloch, and an apostrophe that comes out as "�" when
 * the file was saved in another encoding ("Brye�shawn Butler").
 *
 * Used by Import Bulk Tickets (ticketBulkImport.ts) and the Technician
 * Performance Report's import.
 */

/** Nicknames that no spelling rule can turn into the account name — lowercased sheet name → account name. */
export const TECH_NAME_ALIASES: Record<string, string> = {
  "josh malloch": "Joshua Malloch",
};

/** The account name for a sheet name that's a known nickname; otherwise the name as given. */
export function aliasTechName(name: string): string {
  return TECH_NAME_ALIASES[name.trim().toLowerCase()] ?? name;
}

/** Name parts, lowercased: apostrophes (and the "�" a garbled one leaves) dropped, Jr / Sr / II / III / IV dropped, any other punctuation splits. */
export function nameTokens(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['‘’ʼ`´�]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !/^(jr|sr|ii|iii|iv)$/.test(t));
}

/** One string per name for "same name, spelled differently" (A'Dejaun = Adejaun, Chris carroll = Chris Carroll). */
export function nameMatchKey(name: string): string {
  return nameTokens(name).join(" ");
}

/**
 * The shorter name's parts all appear in the longer one, starting with the
 * same first name and with at least a first and last name — "Erick Guzman"
 * in "Erick Guzman Juarez", "Jamarion Barnes" in "Jamarion Lavell Barnes".
 */
export function namesOverlap(a: string, b: string): boolean {
  const ta = nameTokens(a), tb = nameTokens(b);
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length < 2 || short[0] !== long[0]) return false;
  return short.every((t) => long.includes(t));
}
