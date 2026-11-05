/**
 * The emails HR sends a candidate from the Hiring table's Actions column
 * (CandidateEmailDialog.tsx) — the wording, what gets filled in from the
 * candidate, and the address checks the page and gmailBridge.ts's
 * send-candidate-email share. No imports, so the server can use it too.
 */

/** "congratulations" is the Non-Technician email; that's the name already saved on past send records. */
export type HiringEmailKind = "screening_passed" | "interview_reminder" | "congratulations" | "congratulations_technician" | "status_update";
export type OrientationZone = "CST" | "EST";

/** Who may send these. Checked against the person's primary and extra roles, in the page and on the server. */
export const CANDIDATE_EMAIL_SENDER_ROLES = new Set(["HR", "ADMIN", "SUPERADMIN"]);

// Shown in the draft until the field above it is filled in. Send stays off while one is left.
const NEEDS_POSITION = "[enter the position above]";
const NEEDS_DATE = "[pick the date above]";
const NEEDS_TIME = "[pick the time above]";
const NEEDS_LINK = "[enter the link above]";
const NEEDS_LOCATION = "[enter the location above]";
const NEEDS_CONTACT = "[enter the name above]";
const NEEDS_NUMBER = "[enter the number above]";
const NEEDS_USERNAME = "[enter the username above]";
const NEEDS_PASSWORD = "[enter the password above]";
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

// ---- The fields -------------------------------------------------------------

export interface EmailFields {
  name: string;
  position: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM" */
  time: string;
  zone: OrientationZone;
  location: string;
  contactPerson: string;
  contactNumber: string;
  username: string;
  /** Always typed by HR. It's only ever in the email itself, never in the send record. */
  password: string;
  /** As typed; see normalizeLink. */
  discordLink: string;
}
export type EmailFieldKey = "position" | "date" | "time" | "location" | "contactPerson" | "contactNumber" | "username" | "password" | "discordLink";

export function formatOrientationDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function formatOrientationTime(hhmm: string, zone: OrientationZone): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"} ${zone}`;
}

/** A pasted "discord.gg/abc" gets its https:// so the link is clickable in the email. */
export function normalizeLink(raw: string): string {
  const link = raw.trim();
  return !link || /^https?:\/\//i.test(link) ? link : `https://${link}`;
}

/** Looks like a web address, with nothing after it. */
export const isValidLink = (raw: string) => /^https?:\/\/[^\s/.]+\.[^\s/]+(\/\S*)?$/i.test(normalizeLink(raw));

const dateText = (f: EmailFields) => (f.date ? formatOrientationDate(f.date) : NEEDS_DATE);
const timeText = (f: EmailFields) => (f.time ? formatOrientationTime(f.time, f.zone) : NEEDS_TIME);
const linkText = (f: EmailFields) => normalizeLink(f.discordLink) || NEEDS_LINK;
const SIGN_OFF = ["Best regards,"];

// ---- The emails -------------------------------------------------------------

export function congratsSubject(position: string): string {
  return `Congratulations! Welcome to US In Home Services – ${positionTitles(position).short || NEEDS_POSITION} Position`;
}

export function congratsBody(f: EmailFields): string {
  const title = positionTitles(f.position).full;
  const article = /^[aeiou]/i.test(title) ? "an" : "a";
  return [
    `Hi ${f.name},`,
    "",
    `Congratulations! We’re pleased to inform you that you have successfully passed our hiring process and have been selected to join US In Home Services as ${article} ${title || NEEDS_POSITION}.`,
    "",
    "Position and Compensation",
    `Position: ${title || NEEDS_POSITION}`,
    "",
    "Orientation and Onboarding Details",
    `Date: ${dateText(f)}`,
    "",
    `Time: ${timeText(f)}`,
    "",
    "Location: Orientation Room",
    "",
    `Discord Link: ${linkText(f)}`,
    "",
    "Please join the Discord server and look for the Orientation Room at your scheduled time. Your onboarding forms and other required documents will be prepared for you to complete during the orientation.",
    "",
    "Please ensure that you are on time and ready to participate in the onboarding process.",
    "",
    "Congratulations once again! We’re excited to welcome you to US In Home Services and look forward to having you as part of our team.",
    "",
    ...SIGN_OFF,
  ].join("\n");
}

export function technicianCongratsBody(f: EmailFields): string {
  return [
    `Hi ${f.name},`,
    "",
    "Congratulations! We are pleased to inform you that you passed your technician interview with US In Home Services.",
    "",
    "We are excited to welcome you to our team and move you forward to the next stage of our hiring and onboarding process.",
    "",
    "Please review the following training details and complete the required onboarding steps before your scheduled start date.",
    "",
    "Training Details",
    "",
    `Date: ${dateText(f)}`,
    `Time: ${timeText(f)}`,
    `Location: ${f.location.trim() || NEEDS_LOCATION}`,
    `Contact Person: ${f.contactPerson.trim() || NEEDS_CONTACT}`,
    `Contact Number: ${f.contactNumber.trim() || NEEDS_NUMBER}`,
    "",
    "Next Steps and Onboarding Instructions",
    "",
    "Please complete the following before your start date:",
    "",
    "1. Change your Discord display name to Full Name_Branch Location.",
    "2. Log in to your AHS Employee Account using the credentials provided below:",
    "   Link: https://adminhubsolution.com/",
    `   Username: ${f.username.trim() || NEEDS_USERNAME}`,
    `   Password: ${f.password.trim() || NEEDS_PASSWORD}`,
    "   Unique ID: USIHS",
    "3. Complete your account setup and enter all required information.",
    "4. All required onboarding forms, including your employment contract, have been sent to your AHS Employee Account. Please log in and click the Chat icon to access your forms.",
    "5. Complete and sign your employment contract before your scheduled orientation date. Please ensure that all required information and signatures are submitted on time.",
    "6. Complete all other required onboarding forms before your first day of training.",
    "7. Attend your scheduled in-person training and follow all instructions provided by the training team.",
    "",
    "Discord Orientation",
    "",
    "Please join Discord using the link below on your scheduled orientation day:",
    "",
    linkText(f),
    "",
    "Once you join the Discord server, please proceed to the Orientation Room for your orientation.",
    "",
    "On your first day, please arrive at the onsite location on time. You will also need to join the Orientation Room through Discord for a brief orientation. HR and your Branch Manager will welcome you, address any questions or concerns regarding your contract and onboarding requirements, and provide further instructions before you begin your in-person training.",
    "",
    "Once again, congratulations and welcome to US In Home Services! We look forward to having you on the team and supporting you throughout your training.",
    "",
    "NOTE: If you have any questions or concerns regarding your contract or onboarding requirements, please feel free to reach out to us. We will be happy to assist you and can also address any questions during your scheduled orientation.",
    "",
    ...SIGN_OFF,
  ].join("\n");
}

export function screeningPassedBody(f: EmailFields): string {
  return [
    `Hi ${f.name},`,
    "",
    "Congratulations! We’re pleased to let you know that you’ve successfully passed the screening interview.",
    "",
    "We’d like to invite you to the next stage of the interview process. Please see the details below:",
    "",
    `Date: ${dateText(f)}`,
    `Time: ${timeText(f)}`,
    `Discord link: ${linkText(f)}`,
    "",
    "Interview Requirements",
    "",
    "- Please keep your camera on throughout the interview.",
    "- Change your Discord display name to your First Name_Last Name_INTERVIEW.",
    "  Example: John_Smith_INTERVIEW",
    "- Join the Discord channel 5–10 minutes before your scheduled interview.",
    "- Ensure you have a stable internet connection and are in a quiet and appropriate environment.",
    "- Please be prepared to discuss your experience, skills, and qualifications.",
    "",
    "We look forward to speaking with you again and learning more about you.",
    "",
    "Congratulations once again, and best of luck on the next stage!",
    "",
    ...SIGN_OFF,
  ].join("\n");
}

export function interviewReminderBody(f: EmailFields, today: string): string {
  return [
    `Hi ${f.name},`,
    "",
    `This is a friendly reminder about your interview scheduled for ${f.date === today ? "today, " : ""}${dateText(f)}, at ${timeText(f)}.`,
    "",
    `Discord Link: ${linkText(f)}`,
    "",
    "Please remember to:",
    "",
    "- Join the Discord channel at least 5 minutes before your scheduled interview.",
    "- Keep your camera on throughout the interview.",
    "- Change your Discord display name to First Name_Last Name_INTERVIEW.",
    "- Make sure you have a stable internet connection and are in a quiet and appropriate environment.",
    "- Be prepared to discuss your experience, skills, and qualifications.",
    "",
    "We look forward to speaking with you. Best of luck with your interview!",
    "",
    ...SIGN_OFF,
  ].join("\n");
}

export const STATUS_UPDATE_SUBJECT = "Application Status Update";

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
    ...SIGN_OFF,
  ].join("\n");
}

export interface HiringEmailTemplate {
  title: string;
  /** The Actions menu. */
  menuLabel: string;
  /** The Actions column's "Congrats sent 11/5/2026" line. */
  short: string;
  /** What the date and time are for: the labels and messages say "Orientation Date", and so on. */
  dateWord: "Orientation" | "Training" | "Interview" | null;
  fields: EmailFieldKey[];
  subject: (f: EmailFields, today: string) => string;
  body: (f: EmailFields, today: string) => string;
}

/** In hiring order, which is also the Actions menu's order. */
export const HIRING_EMAIL_KINDS: HiringEmailKind[] = ["screening_passed", "interview_reminder", "congratulations", "congratulations_technician", "status_update"];
export const isHiringEmailKind = (value: unknown): value is HiringEmailKind => HIRING_EMAIL_KINDS.includes(value as HiringEmailKind);

export const HIRING_EMAIL_TEMPLATES: Record<HiringEmailKind, HiringEmailTemplate> = {
  screening_passed: {
    title: "Passed Screening Interview Email",
    menuLabel: "Passed Screening Interview",
    short: "Screening",
    dateWord: "Interview",
    fields: ["date", "time", "discordLink"],
    subject: () => "Congratulations! You Passed the Screening Interview",
    body: screeningPassedBody,
  },
  interview_reminder: {
    title: "Interview Reminder Email",
    menuLabel: "Interview Reminder",
    short: "Reminder",
    dateWord: "Interview",
    fields: ["date", "time", "discordLink"],
    subject: (f) => `Interview Reminder – ${dateText(f)} at ${timeText(f)}`,
    body: interviewReminderBody,
  },
  congratulations: {
    title: "Congratulatory Email – Non-Technician",
    menuLabel: "Congratulatory – Non-Technician",
    short: "Congrats",
    dateWord: "Orientation",
    fields: ["position", "date", "time", "discordLink"],
    subject: (f) => congratsSubject(f.position),
    body: congratsBody,
  },
  congratulations_technician: {
    title: "Congratulatory Email – Technician",
    menuLabel: "Congratulatory – Technician",
    short: "Congrats (Tech)",
    dateWord: "Training",
    fields: ["date", "time", "location", "contactPerson", "contactNumber", "username", "password", "discordLink"],
    subject: () => congratsSubject("Technician"),
    body: technicianCongratsBody,
  },
  status_update: {
    title: "Status Update Email",
    menuLabel: "Status Update",
    short: "Status",
    dateWord: null,
    fields: [],
    subject: () => STATUS_UPDATE_SUBJECT,
    body: (f) => statusUpdateBody(f.name),
  },
};

/** The first thing that still needs filling in, for the email window's Send button. */
export function emailFieldProblem(kind: HiringEmailKind, f: EmailFields, today: string): string | null {
  const { fields, dateWord } = HIRING_EMAIL_TEMPLATES[kind];
  const word = (dateWord ?? "").toLowerCase();
  const needs = (key: EmailFieldKey) => fields.includes(key);
  if (needs("position") && !f.position.trim()) return "Enter the position.";
  if (needs("date") && !f.date) return `Pick the ${word} date.`;
  if (needs("date") && f.date < today) return `The ${word} date has already passed.`;
  if (needs("time") && !f.time) return `Pick the ${word} time.`;
  if (needs("location") && !f.location.trim()) return "Enter the location.";
  if (needs("contactPerson") && !f.contactPerson.trim()) return "Enter the contact person.";
  if (needs("contactNumber") && !f.contactNumber.trim()) return "Enter the contact number.";
  if (needs("username") && !f.username.trim()) return "Enter the username.";
  if (needs("password") && !f.password.trim()) return "Enter the password.";
  if (needs("discordLink") && !f.discordLink.trim()) return "Enter the Discord link.";
  if (needs("discordLink") && !isValidLink(f.discordLink)) return "Check the Discord link. It should look like https://discord.gg/abc123.";
  return null;
}

/**
 * Keeps a draft in step with the fields above it. An untouched draft is simply
 * the new text; one HR has edited keeps their wording, and only the lines the
 * field change affects are swapped, unless they rewrote that line themselves.
 */
export function carryFieldChanges(current: string, before: string, after: string): string {
  if (current === before) return after;
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const lines = current.split("\n");
  beforeLines.forEach((line, i) => {
    if (line === afterLines[i]) return;
    const at = lines.indexOf(line);
    if (at >= 0) lines[at] = afterLines[i];
  });
  return lines.join("\n");
}

// ---- What gets filled in for you ---------------------------------------------

/** Technician training starts here unless the candidate has their own time saved. HR can change it. */
const DEFAULT_TRAINING_TIME = "08:00";
const DEFAULT_TRAINING_ZONE: OrientationZone = "CST";

// The invites from HR's own templates. Once someone sends a different one, that's what's used next (latestDiscordLink).
const DISCORD_LINK_GROUP: Record<HiringEmailKind, string> = {
  screening_passed: "interview",
  interview_reminder: "interview",
  congratulations: "non_technician",
  congratulations_technician: "technician",
  status_update: "none",
};
const STARTING_DISCORD_LINK: Record<string, string> = {
  interview: "https://discord.gg/cZ42d28Dr",
  non_technician: "https://discord.gg/nEbbTFxRa",
  technician: "https://discord.gg/7xx2R7TYc",
};

/** The Discord link most recently sent for this kind of email, by anyone. Interview emails share one room, so they share a link. */
export function latestDiscordLink(sent: Iterable<{ kind: HiringEmailKind; discordLink: string; date: string }>, kind: HiringEmailKind): string | null {
  let latest: { discordLink: string; date: string } | null = null;
  for (const e of sent) {
    if (!e.discordLink || DISCORD_LINK_GROUP[e.kind] !== DISCORD_LINK_GROUP[kind]) continue;
    if (!latest || e.date > latest.date) latest = e;
  }
  return latest?.discordLink ?? null;
}

export function formatLocationAddress(l: { address1: string; address2: string; city: string; state: string; zipCode: string }): string {
  const stateZip = [l.state, l.zipCode].map((v) => v.trim()).filter(Boolean).join(" ");
  return [l.address1, l.address2, l.city, stateZip].map((v) => v.trim()).filter(Boolean).join(", ");
}

export interface EmailPrefillSource {
  candidateName: string;
  position: string | null;
  interviewDate: string | null;
  interviewTime: string | null;
  interviewTimezone: OrientationZone | null;
  trainingStartDate: string | null;
  startDate: string | null;
  trainingTimeIn: string | null;
  /** The branch's address, else its name. */
  location: string;
  contactPerson: string;
  contactNumber: string;
  username: string;
  lastDiscordLink: string | null;
}

/**
 * Everything the app already knows for this email. HR can still change any of
 * it. A date that's already passed isn't used, nor its time, since they'd be
 * out of date; those stay empty and Send asks for them. Technician training
 * falls back to 8:00 AM CST. The password is never filled in.
 */
export function prefillEmailFields(kind: HiringEmailKind, src: EmailPrefillSource, today: string): EmailFields {
  const isInterview = HIRING_EMAIL_TEMPLATES[kind].dateWord === "Interview";
  const date = (isInterview ? src.interviewDate : src.trainingStartDate || src.startDate)?.slice(0, 10) ?? "";
  const time = (isInterview ? src.interviewTime : src.trainingTimeIn)?.slice(0, 5) ?? "";
  const stale = !!date && date < today;
  const savedTime = stale ? "" : time;
  const useDefaultTime = kind === "congratulations_technician" && !savedTime;
  return {
    name: greetingName(src.candidateName),
    position: src.position?.trim() ?? "",
    date: stale ? "" : date,
    time: useDefaultTime ? DEFAULT_TRAINING_TIME : savedTime,
    zone: useDefaultTime ? DEFAULT_TRAINING_ZONE : src.interviewTimezone ?? "CST",
    location: src.location,
    contactPerson: src.contactPerson,
    contactNumber: src.contactNumber,
    username: src.username,
    password: "",
    discordLink: src.lastDiscordLink ?? STARTING_DISCORD_LINK[DISCORD_LINK_GROUP[kind]] ?? "",
  };
}

/** For warning when the Technician / Non-Technician email doesn't match the candidate. */
export const isTechnicianPosition = (position: string | null | undefined) => /^technic/i.test(position?.trim() ?? "");

// ---- Signature photo ---------------------------------------------------------

/** About 1 MB of image once it's in a data: URL. Same limit as migration 0430's check. */
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
    .replace(/^ +/gm, (spaces) => "&nbsp;".repeat(spaces.length)) // keeps a list's indented lines indented
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
