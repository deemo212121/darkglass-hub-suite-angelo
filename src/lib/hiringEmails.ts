/**
 * The two emails HR sends a candidate from the Hiring table's Actions column
 * (CandidateEmailDialog.tsx) — the wording, the name/position fill-ins, and
 * the address checks the page and gmailBridge.ts's send-candidate-email share.
 * No imports, so the server can use it too.
 */

export type HiringEmailKind = "congratulations" | "status_update";
export type OrientationZone = "CST" | "EST";

/** Who may send these. Checked against the person's primary and extra roles, in the page and on the server. */
export const CANDIDATE_EMAIL_SENDER_ROLES = new Set(["HR", "ADMIN", "SUPERADMIN"]);

export const HIRING_EMAIL_TITLE: Record<HiringEmailKind, string> = {
  congratulations: "Congratulatory Email",
  status_update: "Status Update Email",
};
/** The Actions column's "Congrats sent 11/5/2026" line. */
export const HIRING_EMAIL_SHORT: Record<HiringEmailKind, string> = {
  congratulations: "Congrats",
  status_update: "Status",
};

export const ORIENTATION_DISCORD_LINK = "https://discord.gg/nEbbTFxRa";
export const STATUS_UPDATE_SUBJECT = "Application Status Update";

// Shown in the draft until the field above it is filled in. Send stays off while one is left.
const NEEDS_POSITION = "[enter the position above]";
const NEEDS_DATE = "[pick the date above]";
const NEEDS_TIME = "[pick the time above]";
export const hasUnfilledPlaceholder = (text: string) => /\[(enter|pick) the \w+ above\]/.test(text);

// ---- The name in the greeting ----------------------------------------------

const SURNAME_PARTICLES = new Set(["de", "del", "dela", "della", "di", "da", "dos", "du", "la", "las", "los", "le", "san", "santa", "santo", "van", "von", "st", "st."]);
const NAME_SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i;

/** ALL CAPS or all-lowercase names read better as "Ana Marie"; anything else is left as typed. */
function tidyCase(name: string): string {
  if (name !== name.toUpperCase() && name !== name.toLowerCase()) return name;
  return name.toLowerCase().replace(/(^|[\s-])(\S)/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/**
 * The given name(s) from a full name: "Ana Cruz" → "Ana", "John Michael Santos"
 * → "John Michael", "Ana Dela Cruz" → "Ana", "CRUZ, ANA MARIE" → "Ana Marie".
 * There's only one full-name field to go on, so HR can still correct it in the
 * draft before sending.
 */
export function greetingName(fullName: string): string {
  const clean = fullName.trim().replace(/\s+/g, " ");
  if (!clean) return "";
  const comma = clean.indexOf(",");
  if (comma > 0 && clean.slice(comma + 1).trim()) return tidyCase(clean.slice(comma + 1).trim());
  const words = clean.replace(",", "").split(" ");
  while (words.length > 1 && NAME_SUFFIX.test(words[words.length - 1])) words.pop();
  if (words.length <= 2) return tidyCase(words[0]);
  // The surname is the last word plus any "dela" / "de la" in front of it.
  let surnameStart = words.length - 1;
  while (surnameStart > 1 && SURNAME_PARTICLES.has(words[surnameStart - 1].toLowerCase())) surnameStart--;
  return tidyCase(words.slice(0, surnameStart).join(" "));
}

// ---- The position ----------------------------------------------------------

const CSR_POSITION = /^(csr( associate| agent)?|customer service( representative| associate| agent)?( \(csr\))?)$/i;

/** The body's title and the subject's short form — "CSR Associate" → "Customer Service Representative (CSR)" and "CSR". */
export function positionTitles(position: string): { full: string; short: string } {
  const p = position.trim().replace(/\s+/g, " ");
  return CSR_POSITION.test(p) ? { full: "Customer Service Representative (CSR)", short: "CSR" } : { full: p, short: p };
}

// ---- Congratulatory email --------------------------------------------------

export interface CongratsFields {
  name: string;
  position: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM" */
  time: string;
  zone: OrientationZone;
}

export function formatOrientationDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function formatOrientationTime(hhmm: string, zone: OrientationZone): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"} ${zone}`;
}

const positionLine = (f: CongratsFields) => `Position: ${positionTitles(f.position).full || NEEDS_POSITION}`;
const dateLine = (f: CongratsFields) => `Date: ${f.date ? formatOrientationDate(f.date) : NEEDS_DATE}`;
const timeLine = (f: CongratsFields) => `Time: ${f.time ? formatOrientationTime(f.time, f.zone) : NEEDS_TIME}`;

export function congratsSubject(position: string): string {
  return `Congratulations! Welcome to US In Home Services – ${positionTitles(position).short || NEEDS_POSITION} Position`;
}

export function congratsBody(f: CongratsFields): string {
  const title = positionTitles(f.position).full;
  const article = /^[aeiou]/i.test(title) ? "an" : "a";
  return [
    `Hi ${f.name},`,
    "",
    `Congratulations! We’re pleased to inform you that you have successfully passed our hiring process and have been selected to join US In Home Services as ${article} ${title || NEEDS_POSITION}.`,
    "",
    "Position and Compensation",
    positionLine(f),
    "",
    "Orientation and Onboarding Details",
    dateLine(f),
    "",
    timeLine(f),
    "",
    "Location: Orientation Room",
    "",
    `Discord Link: ${ORIENTATION_DISCORD_LINK}`,
    "",
    "Please join the Discord server and look for the Orientation Room at your scheduled time. Your onboarding forms and other required documents will be prepared for you to complete during the orientation.",
    "",
    "Please ensure that you are on time and ready to participate in the onboarding process.",
    "",
    "Congratulations once again! We’re excited to welcome you to US In Home Services and look forward to having you as part of our team.",
    "",
    "Best regards,",
    "HR Team USIHS",
  ].join("\n");
}

/** Keeps a hand-edited draft in step with the Position / Date / Time fields without touching the rest of it. */
export function patchCongratsLines(body: string, f: CongratsFields): string {
  return body
    .replace(/^Position:.*$/m, () => positionLine(f))
    .replace(/^Date:.*$/m, () => dateLine(f))
    .replace(/^Time:.*$/m, () => timeLine(f));
}

// ---- Status update email ---------------------------------------------------

export function statusUpdateBody(name: string): string {
  return [
    `Dear ${name},`,
    "",
    "Thank you for taking the time to apply and interview for the position at our company.",
    "",
    "After careful consideration, we regret to inform you that we have decided to move forward with other candidates whose qualifications more closely match our current needs.",
    "",
    "We appreciate your interest in joining our team and the time you invested in our hiring process. We wish you the best of luck in your future career endeavors.",
    "",
    "Best regards,",
    "HR Team USIHS",
  ].join("\n");
}

// ---- Signature photo ---------------------------------------------------------

/** About 1 MB of image once it's in a data: URL. Same limit as migration 0428's check. */
export const MAX_SIGNATURE_IMAGE_LENGTH = 1_500_000;
export const MAX_SIGNATURE_NAME_LENGTH = 80;
/** The remembered choice when the last email went out with no signature. */
export const NO_SIGNATURE = "none";

/** What this person may pick: their own signatures first, then ones shared with HR. */
export function selectableSignatures<T extends { mine: boolean; shared: boolean; name: string }>(list: readonly T[]): T[] {
  return list
    .filter((s) => s.mine || s.shared)
    .sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name));
}

/** Where the dropdown starts: the last one used if it's still there, else the first on the list. "" means None. */
export function defaultSignatureId(selectable: readonly { id: string }[], last: string | null): string {
  if (last === NO_SIGNATURE) return "";
  if (last && selectable.some((s) => s.id === last)) return last;
  return selectable[0]?.id ?? "";
}

/** The stored data: URL's parts, or null if it isn't one of the image types an email can show. */
export function parseSignatureImage(dataUrl: string | null | undefined): { mimeType: string; base64: string } | null {
  const m = /^data:(image\/(?:png|jpeg|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl ?? "");
  return m ? { mimeType: m[1], base64: m[2] } : null;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The email as HTML, with the signature photo after the last line — the sign-off. Links stay clickable. */
export function emailBodyHtml(body: string, imageCid: string): string {
  const text = escapeHtml(body.trimEnd())
    .replace(/https?:\/\/[^\s<]+/g, (match) => {
      const url = match.replace(/[.,;:!?)]+$/, "");
      return `<a href="${url}">${url}</a>${match.slice(url.length)}`;
    })
    .replace(/\r?\n/g, "<br>\n");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${text}<br><br><img src="cid:${imageCid}" alt="Email signature" style="display:block;max-width:100%;height:auto"></div>`;
}

// ---- Sending accounts --------------------------------------------------------

/** What this person may send from: their own connected Gmail accounts first, then ones shared with HR. */
export function sendableAccounts<T extends { mine: boolean; shared: boolean; email: string }>(accounts: readonly T[]): T[] {
  return accounts
    .filter((a) => a.mine || a.shared)
    .sort((a, b) => Number(b.mine) - Number(a.mine) || a.email.localeCompare(b.email));
}

// ---- Addresses ---------------------------------------------------------------

export function isValidEmail(value: string): boolean {
  return /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(value.trim());
}

/** A CC box's addresses, split on commas, semicolons or spaces. */
export function parseEmailList(value: string): string[] {
  return value.split(/[,;\s]+/).filter(Boolean);
}
