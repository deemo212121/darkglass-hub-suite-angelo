/**
 * Accounting → Tech Damages (migration 0440) — one row per damage a
 * technician caused (house damage, parts damage or both). Total and Balance
 * come from the database (total = house + parts, balance = total −
 * deduction per payroll); who may write, the stamps and the History tab are
 * enforced by the table's triggers and RLS. This file reads and writes, and
 * holds the page's pure helpers (yearly counts, cut-off periods, filters).
 */
import { supabase } from "./client";
import { storageFileName } from "@/lib/storageFileName";
import { payPeriodContaining, type PayPeriod } from "@/lib/payPeriods";
import { addDaysISO } from "@/lib/localDate";

export type TechDamageStatus = "ongoing" | "paid";
export type TechDamageFileKind = "damage" | "waiver";

export interface TechDamageFile {
  path: string;
  name: string;
  uploadedAt: string;
  uploadedBy: string | null;
}

export interface TechDamage {
  id: string;
  companyId: string;
  area: string;
  bmSbm: string;
  technicianProfileId: string | null;
  technicianName: string;
  damageDate: string;
  ticketNumber: string;
  damageType: string;
  houseDamage: number;
  partsDamage: number;
  totalAmount: number;
  deductionPerPayroll: number;
  cutoffDate: string | null;
  balance: number;
  status: TechDamageStatus;
  notes: string;
  damageFiles: TechDamageFile[];
  waiverFiles: TechDamageFile[];
  createdByName: string | null;
  createdAt: string;
  updatedByName: string | null;
  updatedAt: string;
  deletedAt: string | null;
  deletedByName: string | null;
}

export interface TechDamageEvent {
  id: string;
  damageId: string;
  action: "created" | "edited" | "deleted" | "restored";
  detail: string;
  actorName: string | null;
  createdAt: string;
}

/** What the form saves — Total and Balance are never sent (the database works them out). */
export interface TechDamageInput {
  area: string;
  bmSbm: string;
  technicianProfileId: string | null;
  technicianName: string;
  damageDate: string;
  ticketNumber: string;
  damageType: string;
  houseDamage: number;
  partsDamage: number;
  deductionPerPayroll: number;
  cutoffDate: string | null;
  status: TechDamageStatus;
  notes: string;
}

const COLUMNS =
  "id, company_id, area, bm_sbm, technician_profile_id, technician_name, damage_date, ticket_number, damage_type, house_damage, parts_damage, total_amount, deduction_per_payroll, cutoff_date, balance, status, notes, damage_files, waiver_files, created_by_name, created_at, updated_by_name, updated_at, deleted_at, deleted_by_name";
const BUCKET = "tech-damage-files";
const PAGE_SIZE = 1000;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const files = (v: unknown): TechDamageFile[] =>
  Array.isArray(v)
    ? v
        .filter((f) => f && typeof f.path === "string")
        .map((f) => ({ path: f.path, name: String(f.name || f.path.split("/").pop() || "file"), uploadedAt: String(f.uploadedAt || ""), uploadedBy: f.uploadedBy ?? null }))
    : [];

export function mapTechDamage(r: any): TechDamage {
  return {
    id: r.id,
    companyId: r.company_id,
    area: r.area ?? "",
    bmSbm: r.bm_sbm ?? "",
    technicianProfileId: r.technician_profile_id ?? null,
    technicianName: r.technician_name ?? "",
    damageDate: String(r.damage_date ?? "").slice(0, 10),
    ticketNumber: r.ticket_number ?? "",
    damageType: r.damage_type ?? "",
    houseDamage: num(r.house_damage),
    partsDamage: num(r.parts_damage),
    totalAmount: num(r.total_amount),
    deductionPerPayroll: num(r.deduction_per_payroll),
    cutoffDate: r.cutoff_date ? String(r.cutoff_date).slice(0, 10) : null,
    balance: num(r.balance),
    status: r.status === "paid" ? "paid" : "ongoing",
    notes: r.notes ?? "",
    damageFiles: files(r.damage_files),
    waiverFiles: files(r.waiver_files),
    createdByName: r.created_by_name ?? null,
    createdAt: r.created_at,
    updatedByName: r.updated_by_name ?? null,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
    deletedByName: r.deleted_by_name ?? null,
  };
}

function toRow(input: TechDamageInput): Record<string, unknown> {
  const money = (n: number) => Math.round(Math.max(0, num(n)) * 100) / 100;
  return {
    area: input.area.trim(),
    bm_sbm: input.bmSbm.trim(),
    technician_profile_id: input.technicianProfileId,
    technician_name: input.technicianName.trim(),
    damage_date: input.damageDate,
    ticket_number: input.ticketNumber.trim(),
    damage_type: input.damageType.trim(),
    house_damage: money(input.houseDamage),
    parts_damage: money(input.partsDamage),
    deduction_per_payroll: money(input.deductionPerPayroll),
    cutoff_date: input.cutoffDate || null,
    status: input.status,
    notes: input.notes.trim(),
  };
}

/** Postgres "relation does not exist" / PostgREST "not in schema cache" — 0440 hasn't been run. */
export function isTechDamagesMissing(message: string | null | undefined): boolean {
  const m = message || "";
  return /tech_damage/i.test(m) && /does not exist|schema cache|could not find/i.test(m);
}

export async function getTechDamages(): Promise<TechDamage[]> {
  const all: TechDamage[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("tech_damages")
      .select(COLUMNS)
      .order("damage_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []).map(mapTechDamage));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

export async function getTechDamageEvents(): Promise<TechDamageEvent[]> {
  const all: TechDamageEvent[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("tech_damage_events")
      .select("id, damage_id, action, detail, actor_name, created_at")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    all.push(
      ...(data ?? []).map((r: any) => ({
        id: r.id,
        damageId: r.damage_id,
        action: r.action,
        detail: r.detail ?? "",
        actorName: r.actor_name ?? null,
        createdAt: r.created_at,
      }))
    );
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

export async function createTechDamage(input: TechDamageInput): Promise<TechDamage> {
  const { data, error } = await supabase.from("tech_damages").insert(toRow(input)).select(COLUMNS).single();
  if (error) throw new Error(error.message);
  return mapTechDamage(data);
}

async function updateRow(id: string, patch: Record<string, unknown>): Promise<TechDamage> {
  const { data, error } = await supabase.from("tech_damages").update(patch).eq("id", id).select(COLUMNS).single();
  if (error) throw new Error(error.message);
  return mapTechDamage(data);
}

export const updateTechDamage = (id: string, input: TechDamageInput) => updateRow(id, toRow(input));
export const deleteTechDamage = (id: string) => updateRow(id, { deleted_at: new Date().toISOString() });
export const restoreTechDamage = (id: string) => updateRow(id, { deleted_at: null });

const fileColumn = (kind: TechDamageFileKind) => (kind === "damage" ? "damage_files" : "waiver_files");

/** Uploads the files, then adds them to the row's list. Returns the updated row. */
export async function addTechDamageFiles(damage: TechDamage, kind: TechDamageFileKind, list: File[], uploadedBy: string | null): Promise<TechDamage> {
  const added: TechDamageFile[] = [];
  for (const file of list) {
    const path = `${damage.companyId}/${damage.id}/${kind}-${Date.now()}_${storageFileName(file.name)}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
    if (error) throw new Error(`${file.name}: ${error.message}`);
    added.push({ path, name: file.name, uploadedAt: new Date().toISOString(), uploadedBy });
  }
  const current = kind === "damage" ? damage.damageFiles : damage.waiverFiles;
  return updateRow(damage.id, { [fileColumn(kind)]: [...current, ...added] });
}

/** Takes the file off the row, then removes it from storage (best effort — the row is the record). */
export async function removeTechDamageFile(damage: TechDamage, kind: TechDamageFileKind, path: string): Promise<TechDamage> {
  const current = kind === "damage" ? damage.damageFiles : damage.waiverFiles;
  const updated = await updateRow(damage.id, { [fileColumn(kind)]: current.filter((f) => f.path !== path) });
  await supabase.storage.from(BUCKET).remove([path]).catch(() => undefined);
  return updated;
}

/** The bucket is private — a short-lived link, made when someone opens the file. */
export async function getTechDamageFileUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// ---------------------------------------------------------------------
// Pure helpers (tested in techDamages.test.ts)
// ---------------------------------------------------------------------

export const yearOf = (iso: string | null | undefined) => (iso ? Number(iso.slice(0, 4)) : NaN);

/** One person across rows: their account when linked, else the typed name. */
export const technicianKey = (d: Pick<TechDamage, "technicianProfileId" | "technicianName">) =>
  d.technicianProfileId || `name:${d.technicianName.trim().toLowerCase()}`;

/**
 * Each technician's House / Parts damage count per year — how many damages
 * (not deleted) that year had a house amount, and how many had a parts
 * amount. Keyed "technicianKey|year".
 */
export function yearlyDamageCounts(rows: readonly TechDamage[]): Map<string, { house: number; parts: number }> {
  const out = new Map<string, { house: number; parts: number }>();
  for (const d of rows) {
    if (d.deletedAt) continue;
    const key = `${technicianKey(d)}|${yearOf(d.damageDate)}`;
    const c = out.get(key) ?? { house: 0, parts: 0 };
    if (d.houseDamage > 0) c.house += 1;
    if (d.partsDamage > 0) c.parts += 1;
    out.set(key, c);
  }
  return out;
}

/** Every bi-weekly cut-off period that ends in `year`, newest first. */
export function cutoffPeriodsForYear(year: number): PayPeriod[] {
  const out: PayPeriod[] = [];
  let p = payPeriodContaining(`${year}-12-31`);
  // The period holding Dec 31 usually runs into January — start from the last one that ends in the year.
  if (Number(p.end.slice(0, 4)) > year) p = payPeriodContaining(addDaysISO(p.start, -1));
  while (Number(p.end.slice(0, 4)) === year) {
    out.push(p);
    p = payPeriodContaining(addDaysISO(p.start, -1));
  }
  return out;
}

/** "all" = the whole year (by damage date); "none" = no cut-off date yet; otherwise a period's start date. */
export type CutoffFilter = "all" | "none" | string;

/**
 * Yearly view: damages dated in the year. Cut-off view: damages whose
 * cut-off date falls in that cut-off period, whatever year they happened.
 */
export function inYearAndCutoff(d: Pick<TechDamage, "damageDate" | "cutoffDate">, year: number, cutoff: CutoffFilter): boolean {
  if (cutoff === "all") return yearOf(d.damageDate) === year;
  if (cutoff === "none") return !d.cutoffDate && yearOf(d.damageDate) === year;
  return !!d.cutoffDate && payPeriodContaining(d.cutoffDate).start === cutoff;
}

export type TechDamageSort = "branch-asc" | "branch-desc" | "newest";

/**
 * Branch A → Z (or Z → A): by Area, ignoring case, damages with no area
 * last; within a branch by technician, then newest damage first.
 * "newest": by damage date, newest first.
 */
export function sortTechDamages(rows: readonly TechDamage[], sort: TechDamageSort): TechDamage[] {
  const newest = (a: TechDamage, b: TechDamage) => b.damageDate.localeCompare(a.damageDate) || b.createdAt.localeCompare(a.createdAt);
  if (sort === "newest") return [...rows].sort(newest);
  const dir = sort === "branch-desc" ? -1 : 1;
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
  return [...rows].sort((a, b) => {
    const aa = a.area.trim(), ba = b.area.trim();
    if (!aa !== !ba) return aa ? -1 : 1;
    return dir * cmp(aa, ba) || cmp(a.technicianName, b.technicianName) || newest(a, b);
  });
}

export interface TechDamageTotals {
  count: number;
  house: number;
  parts: number;
  total: number;
  deduction: number;
  balance: number;
  ongoing: number;
}

export function techDamageTotals(rows: readonly TechDamage[]): TechDamageTotals {
  const t: TechDamageTotals = { count: 0, house: 0, parts: 0, total: 0, deduction: 0, balance: 0, ongoing: 0 };
  for (const d of rows) {
    t.count += 1;
    t.house += d.houseDamage;
    t.parts += d.partsDamage;
    t.total += d.totalAmount;
    t.deduction += d.deductionPerPayroll;
    t.balance += d.balance;
    if (d.status === "ongoing") t.ongoing += 1;
  }
  return t;
}
