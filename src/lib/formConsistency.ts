/**
 * Form consistency check — does what a person typed on one signed form
 * (name, SSN, date of birth, address, phone, email, driver's license #)
 * match what they typed on their other signed forms? HR sees the
 * differences on HR Paperworks → Form Inconsistencies
 * (FormInconsistenciesPanel.tsx) and gets a bell notification when a newly
 * signed form disagrees with all of the person's other forms
 * (formConsistencyReviews.ts's notifyHrOfNewInconsistencies).
 *
 * Only each person's latest signed copy of each form type counts — a
 * re-signed W-4 replaces the old one. A form belongs to
 * form_data.employeeId, falling back to recipient_id (recipient_id moves to
 * the HR staffer who countersigns — see getSignableDocumentsForRecipient).
 *
 * Formatting doesn't count as a difference: "Street" vs "St", ZIP+4, phone
 * punctuation, a middle initial on only one form, "Jon" vs "Jonathan",
 * "Jr", a hyphenated or shortened last name, a birth date written day-first.
 *
 * It also lists what's missing or incomplete on a form by itself
 * (missingInfoFor): an address without its city, state or ZIP, an SSN that
 * isn't 9 digits, a date of birth that isn't a date, a short phone number —
 * and a blank field the form can't be complete without (REQUIRED).
 *
 * Pure — no database calls, so the page and the on-sign check count the
 * same way.
 */
import type { SignableDocument, SignableDocumentType } from "@/lib/supabase/signableDocuments";
import { SIGNABLE_DOCUMENT_REGISTRY } from "@/lib/signableDocumentRegistry";

export type ConsistencyField = "name" | "ssn" | "dob" | "address" | "phone" | "email" | "license";

export const CONSISTENCY_FIELDS: ConsistencyField[] = ["name", "ssn", "dob", "address", "phone", "email", "license"];

export const CONSISTENCY_FIELD_LABEL: Record<ConsistencyField, string> = {
  name: "Name",
  ssn: "SSN",
  dob: "Date of birth",
  address: "Address",
  phone: "Phone",
  email: "Email",
  license: "Driver's license #",
};

/** What one form says, as typed. */
interface RawIdentity {
  name?: { first?: unknown; middle?: unknown; last?: unknown; firstMiddle?: unknown };
  ssn?: unknown;
  dob?: unknown;
  address?: { street?: unknown; city?: unknown; state?: unknown; zip?: unknown; cityStateZip?: unknown };
  phone?: unknown;
  email?: unknown;
  license?: unknown;
}

type FormData = Record<string, any>;
const nameOf = (f: FormData, middle = "middleName") => ({ first: f.firstName, middle: f[middle], last: f.lastName });

// Where each form keeps these fields (form_data keys, checked against live
// rows). Forms not listed have no identity fields of their own.
const EXTRACT: Partial<Record<SignableDocumentType, (f: FormData) => RawIdentity>> = {
  i9: (f) => ({ name: nameOf(f, "middleInitial"), ssn: f.ssn, dob: f.dateOfBirth, address: { street: f.address, city: f.city, state: f.state, zip: f.zip }, phone: f.phone, email: f.email }),
  w4: (f) => ({ name: { firstMiddle: f.firstNameMiddleInitial, last: f.lastName }, ssn: f.ssn, address: { street: f.address, cityStateZip: f.cityStateZip } }),
  w4r: (f) => ({ name: { firstMiddle: f.firstNameMiddleInitial, last: f.lastName }, ssn: f.ssn, address: { street: f.address, cityStateZip: f.cityStateZip } }),
  w9: (f) => ({ ssn: [f.ssnPart1, f.ssnPart2, f.ssnPart3].map((p) => (p == null ? "" : String(p))).join(""), address: { street: f.address, cityStateZip: f.cityStateZip } }),
  ssn_card_form: (f) => ({ ssn: f.ssn }),
  contractor_data: (f) => ({ name: nameOf(f), ssn: f.ssn, dob: f.birthDate, address: { street: f.streetAddress, city: f.city, state: f.state, zip: f.zipCode }, phone: f.phoneNumber, email: f.email, license: f.driversLicenseNumber }),
  contractor_data_us: (f) => ({ name: nameOf(f), ssn: f.ssn, dob: f.birthDate, address: { street: f.streetAddress, city: f.city, state: f.state, zip: f.zipCode }, phone: f.phoneNumber, email: f.email, license: f.driversLicenseNumber }),
  direct_deposit: (f) => ({ name: nameOf(f), address: { street: f.streetAddress, city: f.city, state: f.state, zip: f.zipCode } }),
  employee_confidentiality: (f) => ({ address: { street: f.address, city: f.city, state: f.state, zip: f.zip } }),
  nda_form: (f) => ({ address: { street: f.address, city: f.city, state: f.state, zip: f.zip } }),
  master_w2_agreement: (f) => ({ name: nameOf(f), address: { street: f.addressStreet, city: f.addressCity, state: f.addressState, zip: f.addressZip }, phone: f.phone, email: f.email }),
  master_w2_office_agreement: (f) => ({ name: nameOf(f), address: { street: f.addressStreet, city: f.addressCity, state: f.addressState, zip: f.addressZip }, phone: f.phone, email: f.email }),
  master_ph_contractor_agreement: (f) => ({ name: nameOf(f), dob: f.dateOfBirth, phone: f.phone, email: f.email }),
  w8ben: (f) => ({ dob: f.dateOfBirth }),
  drivers_license_form: (f) => ({ license: f.licenseNumber }),
  parts_responsibility: (f) => ({ name: nameOf(f) }),
  pto_ack: (f) => ({ name: nameOf(f) }),
  meal_rest_break: (f) => ({ name: nameOf(f) }),
  mileage_fuel: (f) => ({ name: nameOf(f) }),
  car_iq_agreement: (f) => ({ name: nameOf(f) }),
  vehicle_agreement: (f) => ({ name: nameOf(f) }),
  vehicle_use_agreement: (f) => ({ name: nameOf(f) }),
};

/** Form types this check reads — the page loads only these. */
export const CONSISTENCY_FORM_TYPES = Object.keys(EXTRACT) as SignableDocumentType[];

export function checksIdentityFields(type: SignableDocumentType): boolean {
  return !!EXTRACT[type];
}

// ─── Normalizing ─────────────────────────────────────────────────────────────

const text = (v: unknown) => (v == null ? "" : String(v)).trim();
const digits = (v: unknown) => text(v).replace(/\D+/g, "");
const letters = (v: unknown) =>
  text(v).toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z ]+/g, " ").replace(/\s+/g, " ").trim();

const STATES: Record<string, string> = {
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA", COLORADO: "CO", CONNECTICUT: "CT", DELAWARE: "DE",
  FLORIDA: "FL", GEORGIA: "GA", HAWAII: "HI", IDAHO: "ID", ILLINOIS: "IL", INDIANA: "IN", IOWA: "IA", KANSAS: "KS", KENTUCKY: "KY",
  LOUISIANA: "LA", MAINE: "ME", MARYLAND: "MD", MASSACHUSETTS: "MA", MICHIGAN: "MI", MINNESOTA: "MN", MISSISSIPPI: "MS", MISSOURI: "MO",
  MONTANA: "MT", NEBRASKA: "NE", NEVADA: "NV", NEWHAMPSHIRE: "NH", NEWJERSEY: "NJ", NEWMEXICO: "NM", NEWYORK: "NY", NORTHCAROLINA: "NC",
  NORTHDAKOTA: "ND", OHIO: "OH", OKLAHOMA: "OK", OREGON: "OR", PENNSYLVANIA: "PA", RHODEISLAND: "RI", SOUTHCAROLINA: "SC",
  SOUTHDAKOTA: "SD", TENNESSEE: "TN", TEXAS: "TX", UTAH: "UT", VERMONT: "VT", VIRGINIA: "VA", WASHINGTON: "WA", WESTVIRGINIA: "WV",
  WISCONSIN: "WI", WYOMING: "WY", DISTRICTOFCOLUMBIA: "DC",
};
const stateCode = (v: unknown) => {
  const t = letters(v).replace(/ /g, "");
  return t.length === 2 ? t : STATES[t] ?? t;
};

const STREET_WORDS: Record<string, string> = {
  STREET: "ST", AVENUE: "AVE", AV: "AVE", ROAD: "RD", DRIVE: "DR", LANE: "LN", BOULEVARD: "BLVD", COURT: "CT", CIRCLE: "CIR",
  PLACE: "PL", PARKWAY: "PKWY", HIGHWAY: "HWY", TERRACE: "TER", TRAIL: "TRL", SQUARE: "SQ", COVE: "CV", POINT: "PT", CROSSING: "XING",
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W", NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW",
  APARTMENT: "APT", SUITE: "STE", UNIT: "APT", BUILDING: "BLDG", FLOOR: "FL", ROOM: "RM", SPACE: "SPC",
};
const ORDINALS: Record<string, string> = {
  FIRST: "1ST", SECOND: "2ND", THIRD: "3RD", FOURTH: "4TH", FIFTH: "5TH", SIXTH: "6TH", SEVENTH: "7TH", EIGHTH: "8TH", NINTH: "9TH", TENTH: "10TH",
};
const STREET_TYPES = new Set(["ST", "AVE", "RD", "DR", "LN", "BLVD", "CT", "CIR", "PL", "PKWY", "HWY", "TER", "TRL", "SQ", "WAY", "LOOP", "RUN", "PATH", "ROW", "CV", "PT", "XING", "PIKE"]);
const DIRECTIONS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);
const UNIT_WORDS = new Set(["APT", "STE", "#", "BLDG", "FL", "RM", "SPC", "LOT", "NO"]);

/**
 * House number + street name — what has to match. Left out because forms
 * differ on them for the same address: the unit, the street type ("Rosewood
 * Ave" vs "Rosewood"), directions ("N Main" vs "Main"), and anything after
 * a comma or the street type (a city typed into the street box).
 */
function streetKey(v: unknown): string {
  const line = text(v).split(",")[0].toUpperCase().replace(/\./g, " ").replace(/#/g, " # ");
  const words = line
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((w) => w.match(/^(\d+)([NSEW])$/)?.slice(1) ?? [w]) // "721N" → 721 N
    .map((w) => ORDINALS[w] ?? STREET_WORDS[w] ?? w);
  const unitAt = words.findIndex((w, i) => i > 0 && UNIT_WORDS.has(w));
  let kept = unitAt > 0 ? words.slice(0, unitAt) : words;
  const typeAt = kept.findIndex((w, i) => i > 1 && STREET_TYPES.has(w));
  if (typeAt > 0) kept = kept.slice(0, typeAt);
  // No spaces: "Briarwood" and "Briar Wood" are the same street.
  return kept.filter((w, i) => i === 0 || !DIRECTIONS.has(w)).join("");
}

const SUFFIXES = new Set(["JR", "SR", "II", "III", "IV", "V"]);
const noApostrophes = (v: unknown) => text(v).replace(/['’`]/g, "");
/** Last names: "Smith-Jones" is two words (so "Smith Jones" / "Smith" still match); "O'Brien" is one. */
const nameWords = (v: unknown) => letters(noApostrophes(v)).split(" ").filter((w) => w && !SUFFIXES.has(w));
/** First / middle: a hyphenated first name stays one word ("Anne-Marie A" is first Anne-Marie, middle A). */
const givenWords = (v: unknown) => noApostrophes(v).split(/\s+/).map((w) => letters(w.replace(/-/g, "")).replace(/ /g, "")).filter((w) => w && !SUFFIXES.has(w));
/** What people type in the middle-name box when they have none. */
const NO_MIDDLE = new Set(["NA", "NONE", "NMN", "NO", "X", "NIL"]);

function isoDate(v: unknown): string {
  const t = text(v).trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // No separators: "04121990" (month first) or "19900412" (year first); "04/121990" (one slash left out).
  m = t.match(/^(19|20)(\d{2})(\d{2})(\d{2})$/);
  if (m && Number(m[3]) >= 1 && Number(m[3]) <= 12) return `${m[1]}${m[2]}-${m[3]}-${m[4]}`;
  m = t.match(/^(\d{2})[/.-]?(\d{2})[/.-]?(\d{4})$/) ?? t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? (Number(m[3]) > 30 ? "19" : "20") + m[3] : m[3];
    // Month first, unless the first number can't be a month ("31/08/2004").
    const [mo, d] = Number(m[1]) > 12 ? [m[2], m[1]] : [m[1], m[2]];
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? "" : new Date(ms).toISOString().slice(0, 10);
}

// ─── One field's value on one form ──────────────────────────────────────────

/** `key`: what's compared (and hashed for "Mark as checked"); `display`: what HR sees. */
interface Value {
  key: string;
  display: string;
  data: any;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const PARSE: Record<ConsistencyField, (raw: RawIdentity) => Value | null> = {
  name: (r) => {
    if (!r.name) return null;
    let first: string, middle: string;
    const last = nameWords(r.name.last);
    if (r.name.firstMiddle !== undefined) {
      const words = givenWords(r.name.firstMiddle);
      first = words[0] ?? "";
      middle = words.slice(1).join(" ");
    } else {
      first = givenWords(r.name.first)[0] ?? "";
      middle = givenWords(r.name.middle).join(" ");
    }
    if (!first || last.length === 0) return null;
    // "N/A", or the last name typed into the middle box too — not a middle name.
    if (NO_MIDDLE.has(middle) || last.includes(middle)) middle = "";
    const shown = [r.name.firstMiddle ?? r.name.first, r.name.firstMiddle !== undefined ? "" : r.name.middle, r.name.last].map(text).filter(Boolean).join(" ");
    return { key: `${first}|${middle.slice(0, 1)}|${last.join(" ")}`, display: shown.replace(/\s+/g, " "), data: { first, mi: middle.slice(0, 1), last } };
  },
  ssn: (r) => {
    const d = digits(r.ssn);
    return d.length === 9 ? { key: d, display: `•••-••-${d.slice(5)}`, data: d } : null;
  },
  dob: (r) => {
    const iso = isoDate(r.dob);
    if (!iso) return null;
    const [y, m, d] = iso.split("-");
    return { key: iso, display: `${MONTHS[Number(m) - 1] ?? m} ${Number(d)}, ${y}`, data: { y, m, d } };
  },
  address: (r) => {
    const a = r.address;
    if (!a) return null;
    let city = a.city, state = a.state, zip = a.zip;
    if (a.cityStateZip !== undefined) {
      const m = text(a.cityStateZip).match(/^(.*?)[,\s]+([A-Za-z][A-Za-z .]*?)[,\s]+(\d{4,5})(?:-\d{4})?\s*$/);
      if (m) [city, state, zip] = [m[1], m[2], m[3]];
      else zip = (text(a.cityStateZip).match(/\b\d{5}\b/) ?? [""])[0];
    }
    const street = streetKey(a.street);
    const zip5 = digits(zip).slice(0, 5);
    if (!street && !zip5) return null;
    const place = a.cityStateZip !== undefined
      ? text(a.cityStateZip)
      : [text(city), [text(state), text(zip)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    const shown = [text(a.street), place].filter(Boolean).join(", ");
    return { key: `${street}|${zip5}`, display: shown.replace(/\s+/g, " "), data: { street, zip: zip5, state: stateCode(state) } };
  },
  phone: (r) => {
    const d = digits(r.phone);
    if (d.length < 10) return null;
    const t = d.slice(-10);
    return { key: t, display: `(${t.slice(0, 3)}) ${t.slice(3, 6)}-${t.slice(6)}`, data: t };
  },
  email: (r) => {
    const e = text(r.email).toLowerCase();
    return /^[^\s@]+@[^\s@]+$/.test(e) ? { key: e, display: e, data: e } : null;
  },
  license: (r) => {
    const k = text(r.license).toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");
    return k.length >= 4 ? { key: k, display: `••••${k.slice(-4)}`, data: k } : null;
  },
};

const firstNamesMatch = (a: string, b: string) => a === b || a.startsWith(b) || b.startsWith(a);
/** "GARCIA" vs "GARCIA LOPEZ", "SMITH-JONES" vs "SMITH JONES", or just the initial ("N" vs "NGUYEN"). */
const lastNamesMatch = (a: string[], b: string[]) => {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length === 1 && short[0].length === 1) return long.some((w) => w[0] === short[0]);
  return short.every((w) => long.includes(w));
};

const SAME: Record<ConsistencyField, (a: any, b: any) => boolean> = {
  name: (a, b) => firstNamesMatch(a.first, b.first) && lastNamesMatch(a.last, b.last) && (!a.mi || !b.mi || a.mi === b.mi),
  ssn: (a, b) => a === b,
  // Same date written day-first on one form (common on PH forms).
  dob: (a, b) => a.y === b.y && ((a.m === b.m && a.d === b.d) || (a.m === b.d && a.d === b.m)),
  address: (a, b) => (!a.zip || !b.zip || a.zip === b.zip) && (!a.street || !b.street || a.street === b.street),
  phone: (a, b) => a === b,
  email: (a, b) => a === b,
  license: (a, b) => {
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    return short === long || (short.length >= 6 && long.endsWith(short));
  },
};

/**
 * SSNs stay masked, but the digits that differ between the values are shown
 * (plus the last 4), so HR can see the typo without the full number:
 * "•••-•4-0714" vs "•••-•7-0714".
 */
function ssnDisplays(keys: string[]): string[] {
  const differs = (i: number) => keys.some((k) => k[i] !== keys[0][i]);
  return keys.map((k) => {
    const shown = [...k].map((c, i) => (i >= 5 || differs(i) ? c : "•")).join("");
    return `${shown.slice(0, 3)}-${shown.slice(3, 5)}-${shown.slice(5)}`;
  });
}

/** A short hint when the values are near-misses (a typo is likelier than two real values). */
function hintFor(field: ConsistencyField, reps: Value[]): string | null {
  const allSame = (f: (v: Value) => string) => reps.every((v) => f(v) === f(reps[0]));
  if ((field === "ssn" || field === "phone") && allSame((v) => v.key.slice(-4))) return "Same last 4 digits — the other digits differ (likely a typo)";
  if (field === "license" && allSame((v) => v.key.slice(-4))) return "Same last 4 characters — the rest differs";
  if (field === "dob" && allSame((v) => v.data.y)) return "Same year — month or day differs";
  if (field === "address") {
    if (allSame((v) => v.data.street) && reps.every((v) => v.data.street)) return "Same street — the ZIP differs";
    if (allSame((v) => v.data.zip) && reps.every((v) => v.data.zip)) return "Same ZIP — the street differs";
  }
  if (field === "email" && allSame((v) => v.key.split("@")[0])) return "Same name before the @ — the domain differs";
  return null;
}

// ─── People ─────────────────────────────────────────────────────────────────

export interface ConsistencyForm {
  docId: string;
  documentType: SignableDocumentType;
  status: SignableDocument["status"];
  label: string;
  signedAt: string;
  pdfUrl: string | null;
}

export interface ConsistencyGroup {
  /** The value as typed on the earliest form in the group (SSN / license masked). */
  display: string;
  forms: ConsistencyForm[];
}

export interface Inconsistency {
  field: ConsistencyField;
  /** Stable while the differing values stay the same — "Mark as checked" stores it. */
  valuesKey: string;
  groups: ConsistencyGroup[];
  hint: string | null;
  /** Newest signing among the forms involved. */
  latestAt: string;
  /** "missing": one form is missing part of this field (missingInfoFor) — one group, one form. Unset: forms disagree. */
  kind?: "missing";
  /** What's missing or wrong, e.g. ["state", "ZIP"] or ["only 8 digits"]. */
  missing?: string[];
}

/** Whose form this is — form_data.employeeId, else recipient_id. */
export function documentOwner(d: Pick<SignableDocument, "formData" | "recipientId">): string | null {
  return (d.formData?.employeeId as string | undefined) || d.recipientId || null;
}

const signedAtOf = (d: SignableDocument) => d.signedAt || d.confirmedAt || d.createdAt;

/** cyrb53 — a short, stable hash, so values_key never holds an SSN or address. */
function hash(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The latest signed copy of each form type (oldest first), with what it says. */
function latestSignedForms(docs: SignableDocument[]): { doc: SignableDocument; raw: RawIdentity }[] {
  const latest = new Map<SignableDocumentType, SignableDocument>();
  for (const d of docs) {
    if ((d.status !== "signed" && d.status !== "confirmed") || !EXTRACT[d.documentType]) continue;
    const prev = latest.get(d.documentType);
    if (!prev || signedAtOf(d) > signedAtOf(prev)) latest.set(d.documentType, d);
  }
  return [...latest.values()]
    .sort((a, b) => signedAtOf(a).localeCompare(signedAtOf(b)) || a.id.localeCompare(b.id))
    .map((d) => ({ doc: d, raw: EXTRACT[d.documentType]!(d.formData ?? {}) }));
}

const formRef = (doc: SignableDocument): ConsistencyForm => ({
  docId: doc.id, documentType: doc.documentType, status: doc.status, label: SIGNABLE_DOCUMENT_REGISTRY[doc.documentType]?.label ?? doc.documentType, signedAt: signedAtOf(doc), pdfUrl: doc.pdfUrl,
});

/** One person's differences across their latest signed copy of each form type. */
export function inconsistenciesFor(docs: SignableDocument[]): Inconsistency[] {
  const forms = latestSignedForms(docs);

  const out: Inconsistency[] = [];
  for (const field of CONSISTENCY_FIELDS) {
    const groups: { rep: Value; forms: ConsistencyForm[] }[] = [];
    for (const { doc, raw } of forms) {
      const v = PARSE[field](raw);
      if (!v) continue;
      const form = formRef(doc);
      const g = groups.find((x) => SAME[field](x.rep.data, v.data));
      if (g) g.forms.push(form);
      else groups.push({ rep: v, forms: [form] });
    }
    if (groups.length < 2) continue;
    const displays = field === "ssn" ? ssnDisplays(groups.map((g) => g.rep.key)) : groups.map((g) => g.rep.display);
    out.push({
      field,
      valuesKey: hash(`${field}:${groups.map((g) => g.rep.key).sort().join("||")}`),
      groups: groups.map((g, i) => ({ display: displays[i], forms: g.forms })),
      hint: hintFor(field, groups.map((g) => g.rep)),
      latestAt: groups.flatMap((g) => g.forms).reduce((max, f) => (f.signedAt > max ? f.signedAt : max), ""),
    });
  }
  return out;
}

// ─── Missing / incomplete on one form ───────────────────────────────────────

const STATE_CODES = new Set(Object.values(STATES));

/** Address as typed, split into its parts — from the separate boxes, or out of one "City, ST 12345" line. */
function addressParts(a: NonNullable<RawIdentity["address"]>): { street: string; city: string; state: string; zip: string } {
  const street = text(a.street).trim();
  if (a.cityStateZip === undefined) return { street, city: text(a.city).trim(), state: text(a.state).trim(), zip: text(a.zip).trim() };
  const line = text(a.cityStateZip);
  const zip = (line.match(/\b\d{5}(?:-\d{4})?\b/) ?? [""])[0];
  const words = line.replace(zip, " ").split(/[\s,]+/).filter(Boolean);
  // The state is the last word(s): a 2-letter code ("LA") or a state's name ("Louisiana", "New York").
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    const tail = letters(words.slice(-n).join(" ")).replace(/ /g, "");
    if ((n === 1 && tail.length === 2 && STATE_CODES.has(tail)) || STATES[tail]) {
      return { street, city: words.slice(0, -n).join(" "), state: words.slice(-n).join(" "), zip };
    }
  }
  return { street, city: words.join(" "), state: "", zip };
}

/**
 * A blank field that leaves the form incomplete. Anything not listed here is
 * only flagged when it's filled in wrong (an 8-digit SSN, a 7-digit phone),
 * never for being blank — phone, email and the like are optional on most
 * forms.
 */
const REQUIRED: Partial<Record<ConsistencyField, ReadonlySet<SignableDocumentType>>> = {
  address: new Set<SignableDocumentType>(["i9", "w4", "w4r", "w9"]),
  ssn: new Set<SignableDocumentType>(["w4", "w4r", "w9", "ssn_card_form"]),
  dob: new Set<SignableDocumentType>(["i9"]),
  license: new Set<SignableDocumentType>(["drivers_license_form"]),
};

/** What's missing or wrong in this field on this form — [] when it's complete, null when the form doesn't ask for it. */
function missingIn(field: ConsistencyField, type: SignableDocumentType, raw: RawIdentity): string[] | null {
  const required = !!REQUIRED[field]?.has(type);
  switch (field) {
    case "name": {
      if (!raw.name) return null;
      const first = raw.name.firstMiddle !== undefined ? givenWords(raw.name.firstMiddle)[0] : givenWords(raw.name.first)[0];
      return [...(first ? [] : ["first name"]), ...(nameWords(raw.name.last).length ? [] : ["last name"])];
    }
    case "address": {
      if (!raw.address) return null;
      const p = addressParts(raw.address);
      if (!p.street && !p.city && !p.state && !p.zip) return required ? ["address"] : [];
      return [
        ...(p.street ? [] : ["street"]),
        ...(p.city ? [] : ["city"]),
        ...(p.state ? [] : ["state"]),
        // 4 digits is a full Philippine postal code.
        ...(digits(p.zip).length >= 4 ? [] : [p.zip ? "a full ZIP" : "ZIP"]),
      ];
    }
    case "ssn": {
      if (!("ssn" in raw)) return null;
      const n = digits(raw.ssn).length;
      return n === 0 ? (required ? ["SSN"] : []) : n === 9 ? [] : [`${n} digits instead of 9`];
    }
    case "dob":
      if (!("dob" in raw)) return null;
      return !text(raw.dob).trim() ? (required ? ["date of birth"] : []) : isoDate(raw.dob) ? [] : ["a readable date"];
    case "phone": {
      if (!("phone" in raw)) return null;
      const n = digits(raw.phone).length;
      return n === 0 || n >= 10 ? [] : [`${n} digits instead of 10`];
    }
    case "email": {
      if (!("email" in raw)) return null;
      const e = text(raw.email).trim();
      return !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? [] : ["a valid email"];
    }
    case "license": {
      if (!("license" in raw)) return null;
      const k = text(raw.license).replace(/[^A-Za-z0-9]/g, "");
      return !k ? (required ? ["license #"] : []) : k.length >= 4 ? [] : ["a full license #"];
    }
  }
}

/** The field as typed on that form, for showing next to what's missing. */
function asTyped(field: ConsistencyField, raw: RawIdentity): string {
  if (field === "address" && raw.address) {
    const a = raw.address;
    const place = a.cityStateZip !== undefined ? text(a.cityStateZip) : [text(a.city), [text(a.state), text(a.zip)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    return [text(a.street), place].map((s) => s.trim()).filter(Boolean).join(", ").replace(/\s+/g, " ");
  }
  if (field === "name" && raw.name) return [raw.name.firstMiddle ?? raw.name.first, raw.name.firstMiddle !== undefined ? "" : raw.name.middle, raw.name.last].map(text).filter(Boolean).join(" ").replace(/\s+/g, " ");
  if (field === "ssn") {
    const d = digits(raw.ssn);
    return d ? `${"•".repeat(Math.max(0, d.length - 4))}${d.slice(-4)}` : "";
  }
  if (field === "license") {
    const k = text(raw.license).replace(/[^A-Za-z0-9]/g, "");
    return k ? `••••${k.slice(-4)}` : "";
  }
  return text(raw[field as "dob" | "phone" | "email"]).trim();
}

const listOf = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** One person's latest signed forms that are missing part of a field, one entry per form and field. */
export function missingInfoFor(docs: SignableDocument[]): Inconsistency[] {
  const out: Inconsistency[] = [];
  for (const { doc, raw } of latestSignedForms(docs)) {
    for (const field of CONSISTENCY_FIELDS) {
      const missing = missingIn(field, doc.documentType, raw);
      if (!missing || missing.length === 0) continue;
      const form = formRef(doc);
      // "Missing the state and ZIP" / "Has 8 digits instead of 9" / "Needs a valid email".
      const blank = missing.filter((x) => !/instead of|^a /.test(x));
      const count = missing.filter((x) => /instead of/.test(x));
      const needs = missing.filter((x) => /^a /.test(x));
      const hint = [
        ...(blank.length ? [`Missing the ${listOf(blank)}`] : []),
        ...count.map((x) => `Has ${x}`),
        ...(needs.length ? [`Needs ${listOf(needs)}`] : []),
      ].join("; ");
      out.push({
        field,
        kind: "missing",
        missing,
        valuesKey: hash(`missing:${field}:${doc.id}:${missing.join("|")}`),
        groups: [{ display: asTyped(field, raw) || "(blank)", forms: [form] }],
        hint,
        latestAt: form.signedAt,
      });
    }
  }
  return out;
}

/** Everyone's differences and missing information, by owner profile id (people with none are left out). */
export function findInconsistencies(docs: SignableDocument[]): Map<string, Inconsistency[]> {
  const byOwner = new Map<string, SignableDocument[]>();
  for (const d of docs) {
    const owner = documentOwner(d);
    if (!owner) continue;
    const list = byOwner.get(owner);
    if (list) list.push(d);
    else byOwner.set(owner, [d]);
  }
  const out = new Map<string, Inconsistency[]>();
  for (const [owner, list] of byOwner) {
    const found = [...inconsistenciesFor(list), ...missingInfoFor(list)];
    if (found.length > 0) out.set(owner, found);
  }
  return out;
}
