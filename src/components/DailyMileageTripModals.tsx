/**
 * Daily Mileage → the trip editor and a day's trips.
 *
 * TripEditor: one trip with the workbook's columns (Daily Entry Revised) —
 * total + excluded miles and why, vehicle, branch, ticket #, the two Mile
 * Map links, notes and the approval status. Car IQ, the rate and the pay are
 * shown, not typed: they come from the technician's Car IQ history and the
 * company's rate history for that date.
 *
 * DayTripsModal: every trip a technician has on one day (a grid cell that
 * holds more than a plain number opens this).
 */
import { useState } from "react";
import { ExternalLink, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  EXCLUSION_REASONS,
  MILEAGE_STATUSES,
  VEHICLE_TYPES,
  dayTotals,
  eligibleMiles,
  entryCheck,
  parseMiles,
  statusLabel,
  type DayPricing,
  type MileageStatus,
} from "@/lib/dailyMileage";
import { deleteTrips, insertTrips, isTripColumnsMissing, updateTrip, type TechMileageTrip, type TripFields } from "@/lib/supabase/techDailyMileage";

export interface TripTechnician {
  id: string;
  name: string;
  branch: string;
}

const fmtMiles = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
const fmtMoney = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

export const STATUS_CLASS: Record<MileageStatus, string> = {
  pending: "bg-slate-700/60 text-slate-200",
  needs_review: "bg-amber-500/20 text-amber-200",
  approved: "bg-emerald-500/20 text-emerald-200",
  rejected: "bg-red-500/20 text-red-200",
};

export function StatusBadge({ status }: { status: MileageStatus }) {
  return <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_CLASS[status]}`}>{statusLabel(status)}</span>;
}

/** Car IQ · rate · pay for some eligible miles on a date. */
function pricingText(p: DayPricing, eligible: number) {
  if (p.hasCarIq == null) return { carIq: "Not set", rate: "—", pay: "Car IQ status not set" };
  return { carIq: p.hasCarIq ? "Yes" : "No", rate: p.rate == null ? "—" : `$${p.rate.toFixed(2)}`, pay: p.rate == null ? "—" : fmtMoney(Math.round(eligible * p.rate * 100) / 100) };
}

const input = "w-full rounded-md border border-white/10 bg-slate-800 px-2 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none";
const label = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400";

export function TripEditor({
  trip,
  defaults,
  technicians,
  branches,
  priceOn,
  reviewFields,
  onClose,
  onSaved,
  onDeleted,
}: {
  /** The trip to edit; null adds a new one. */
  trip: TechMileageTrip | null;
  /** For a new trip: who and which day, when already known (a grid cell). */
  defaults?: { profileId?: string; workDate?: string };
  technicians: TripTechnician[];
  branches: string[];
  priceOn: (profileId: string, date: string) => DayPricing;
  /** false when migration 0451 hasn't been run: only miles and notes can be saved. */
  reviewFields: boolean;
  onClose: () => void;
  onSaved: (trip: TechMileageTrip) => void;
  onDeleted: (id: string) => void;
}) {
  const [profileId, setProfileId] = useState(trip?.profileId ?? defaults?.profileId ?? "");
  const [workDate, setWorkDate] = useState(trip?.workDate ?? defaults?.workDate ?? "");
  const [miles, setMiles] = useState(trip ? String(trip.miles) : "");
  const [excluded, setExcluded] = useState(trip?.excludedMiles ? String(trip.excludedMiles) : "");
  const [reason, setReason] = useState(trip?.exclusionReason ?? "");
  const [vehicle, setVehicle] = useState(trip?.vehicle ?? "");
  const [branch, setBranch] = useState(trip?.branch ?? "");
  const [tickets, setTickets] = useState(trip?.ticketRefs ?? "");
  const [totalMap, setTotalMap] = useState(trip?.totalMapUrl ?? "");
  const [eligibleMap, setEligibleMap] = useState(trip?.eligibleMapUrl ?? "");
  const [notes, setNotes] = useState(trip?.notes ?? "");
  const [status, setStatus] = useState<MileageStatus>(trip?.status ?? "pending");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const tech = technicians.find((t) => t.id === profileId);
  const m = parseMiles(miles);
  const x = parseMiles(excluded);
  const draft = { miles: typeof m === "number" && !Number.isNaN(m) ? m : 0, excludedMiles: typeof x === "number" && !Number.isNaN(x) ? x : 0, exclusionReason: reason, status };
  const eligible = eligibleMiles(draft);
  const check = entryCheck(draft);
  const price = profileId && workDate ? pricingText(priceOn(profileId, workDate), eligible) : null;

  const problem =
    !profileId ? "Pick the technician."
    : !workDate ? "Pick the date."
    : m == null || Number.isNaN(m) ? "Total miles must be a number."
    : Number.isNaN(x) ? "Excluded miles must be a number."
    : (x ?? 0) > m ? "Excluded miles can't be more than the total."
    : null;

  const save = async () => {
    if (problem || busy) return;
    setBusy(true);
    setErr(null);
    const fields: Partial<TripFields> = reviewFields
      ? {
          workDate, miles: m as number, excludedMiles: (x as number | null) ?? 0, exclusionReason: reason.trim(), vehicle: vehicle.trim(), branch: branch.trim(),
          ticketRefs: tickets.trim(), totalMapUrl: totalMap.trim(), eligibleMapUrl: eligibleMap.trim(), notes: notes.trim(), status,
        }
      : { workDate, miles: m as number, notes: notes.trim() };
    try {
      const saved = trip ? await updateTrip(trip.id, fields) : (await insertTrips([{ ...fields, profileId, workDate, miles: m as number }]))[0];
      onSaved(saved);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(isTripColumnsMissing(msg) ? "Run migration 0451_tech_daily_mileage_trips.sql in Supabase to save excluded miles, vehicle and approvals." : msg);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!trip || busy || !window.confirm("Delete this trip?")) return;
    setBusy(true);
    try {
      await deleteTrips([trip.id]);
      onDeleted(trip.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const link = (url: string) => (/^https?:\/\//i.test(url) ? <a href={url} target="_blank" rel="noreferrer" className="ml-1 inline-flex text-blue-300 hover:text-blue-200" aria-label="Open link"><ExternalLink className="h-3.5 w-3.5" /></a> : null);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="trip-editor-title" className="flex max-h-[94vh] w-full max-w-2xl flex-col rounded-lg border border-white/10 bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-white/10 px-6 py-4">
          <div>
            <h3 id="trip-editor-title" className="text-lg font-bold text-white">{trip ? "Edit trip" : "Add trip"}</h3>
            {trip?.reviewedByName && <p className="text-xs text-slate-400">{statusLabel(trip.status)} by {trip.reviewedByName}{trip.reviewedAt ? ` · ${new Date(trip.reviewedAt).toLocaleString()}` : ""}</p>}
            {!trip?.reviewedByName && trip?.updatedByName && <p className="text-xs text-slate-400">Last saved by {trip.updatedByName}</p>}
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="p-1 text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {!reviewFields && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Only miles and notes can be saved until migration 0451_tech_daily_mileage_trips.sql is run in Supabase.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className={label}>Technician</span>
              <select value={profileId} onChange={(e) => setProfileId(e.target.value)} disabled={!!trip} className={input} aria-label="Technician">
                <option value="">Pick a technician…</option>
                {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}{t.branch ? ` · ${t.branch}` : ""}</option>)}
              </select>
            </div>
            <div>
              <span className={label}>Date</span>
              <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} className={`${input} [color-scheme:dark]`} aria-label="Date" />
            </div>
            <div>
              <span className={label}>Total miles</span>
              <input value={miles} onChange={(e) => setMiles(e.target.value)} inputMode="decimal" className={`${input} text-right tabular-nums`} aria-label="Total miles" autoFocus={!trip} />
            </div>
            <div>
              <span className={label}>Excluded miles</span>
              <input value={excluded} onChange={(e) => setExcluded(e.target.value)} inputMode="decimal" placeholder="0" disabled={!reviewFields} className={`${input} text-right tabular-nums`} aria-label="Excluded miles" />
            </div>
            <div>
              <span className={label}>Exclusion reason</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} list="mileage-reasons" disabled={!reviewFields} placeholder={x ? "Why were miles taken off?" : ""} className={input} aria-label="Exclusion reason" />
              <datalist id="mileage-reasons">{EXCLUSION_REASONS.map((r) => <option key={r} value={r} />)}</datalist>
            </div>
            <div>
              <span className={label}>Vehicle</span>
              <input value={vehicle} onChange={(e) => setVehicle(e.target.value)} list="mileage-vehicles" disabled={!reviewFields} className={input} aria-label="Vehicle" />
              <datalist id="mileage-vehicles">{VEHICLE_TYPES.map((v) => <option key={v} value={v} />)}</datalist>
            </div>
            <div>
              <span className={label}>Branch</span>
              <input value={branch} onChange={(e) => setBranch(e.target.value)} list="mileage-branches" disabled={!reviewFields} placeholder={tech?.branch || "Their branch"} className={input} aria-label="Branch" />
              <datalist id="mileage-branches">{branches.map((b) => <option key={b} value={b} />)}</datalist>
            </div>
            <div>
              <span className={label}>Ticket #</span>
              <input value={tickets} onChange={(e) => setTickets(e.target.value)} disabled={!reviewFields} placeholder="One or more, separated by commas" className={input} aria-label="Ticket numbers" />
            </div>
            <div>
              <span className={label}>Total Mile Map {link(totalMap)}</span>
              <input value={totalMap} onChange={(e) => setTotalMap(e.target.value)} disabled={!reviewFields} placeholder="https://…" className={input} aria-label="Total mile map link" />
            </div>
            <div>
              <span className={label}>Eligible Mile Map {link(eligibleMap)}</span>
              <input value={eligibleMap} onChange={(e) => setEligibleMap(e.target.value)} disabled={!reviewFields} placeholder="https://…" className={input} aria-label="Eligible mile map link" />
            </div>
          </div>
          <div>
            <span className={label}>Notes</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={input} aria-label="Notes" />
          </div>
          <div>
            <span className={label}>Approval</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Approval status">
              {MILEAGE_STATUSES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  disabled={!reviewFields}
                  onClick={() => setStatus(s.value)}
                  aria-pressed={status === s.value}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition disabled:opacity-40 ${status === s.value ? `${STATUS_CLASS[s.value]} ring-1 ring-white/30` : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Worked out, not typed. */}
          <div className="grid gap-2 rounded-lg border border-white/10 bg-slate-800/40 px-3 py-2 text-sm sm:grid-cols-4">
            <div><p className={label}>Eligible miles</p><p className="font-semibold tabular-nums text-white">{fmtMiles(eligible)}</p></div>
            <div><p className={label}>Car IQ</p><p className={price?.carIq === "Not set" ? "text-amber-300" : "text-slate-200"}>{price?.carIq ?? "—"}</p></div>
            <div><p className={label}>Rate / mile</p><p className="tabular-nums text-slate-200">{price?.rate ?? "—"}</p></div>
            <div><p className={label}>Compensation</p><p className="font-semibold tabular-nums text-emerald-300">{price?.pay ?? "—"}</p></div>
          </div>
          {check && !problem && <p className="text-xs text-amber-300">Entry check: {check}</p>}
          {(err || problem) && <p className={`text-xs ${err ? "text-red-300" : "text-slate-400"}`}>{err ?? problem}</p>}
        </div>

        <div className="flex gap-3 border-t border-white/10 px-6 py-4">
          <button type="button" onClick={save} disabled={!!problem || busy} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : trip ? "Save trip" : "Add trip"}
          </button>
          {trip && (
            <button type="button" onClick={remove} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-red-900/60 px-4 py-2 text-sm font-semibold text-red-100 hover:bg-red-800">
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          )}
          <button type="button" onClick={onClose} disabled={busy} className="flex-1 rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-600">Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function DayTripsModal({
  techName,
  date,
  trips,
  pricing,
  onEdit,
  onAdd,
  onClose,
}: {
  techName: string;
  date: string;
  trips: TechMileageTrip[];
  pricing: DayPricing;
  onEdit: (trip: TechMileageTrip) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const t = dayTotals(trips);
  const price = pricingText(pricing, t.eligible);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="day-trips-title" className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-white/10 bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-white/10 px-6 py-4">
          <div>
            <h3 id="day-trips-title" className="text-lg font-bold text-white">{techName}</h3>
            <p className="text-xs text-slate-400">{fmtDate(date)} · {trips.length} trip{trips.length === 1 ? "" : "s"}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-auto px-6 py-4">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-left text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-1.5 text-right font-semibold">Total</th>
                <th className="py-1.5 text-right font-semibold">Excluded</th>
                <th className="py-1.5 pl-3 font-semibold">Reason</th>
                <th className="py-1.5 text-right font-semibold">Eligible</th>
                <th className="py-1.5 pl-3 font-semibold">Vehicle</th>
                <th className="py-1.5 pl-3 font-semibold">Status</th>
                <th className="py-1.5 pl-3 font-semibold">Check</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {trips.map((trip) => {
                const c = entryCheck(trip);
                return (
                  <tr key={trip.id} className="border-t border-white/5">
                    <td className="py-1.5 text-right text-white">{fmtMiles(trip.miles)}</td>
                    <td className="py-1.5 text-right text-amber-200">{trip.excludedMiles ? fmtMiles(trip.excludedMiles) : "—"}</td>
                    <td className="py-1.5 pl-3 text-slate-300">{trip.exclusionReason || "—"}</td>
                    <td className="py-1.5 text-right font-semibold text-white">{fmtMiles(eligibleMiles(trip))}</td>
                    <td className="py-1.5 pl-3 text-slate-300">{trip.vehicle || "—"}</td>
                    <td className="py-1.5 pl-3"><StatusBadge status={trip.status} /></td>
                    <td className={`py-1.5 pl-3 text-xs ${c ? "text-amber-300" : "text-emerald-300"}`}>{c || "OK"}</td>
                    <td className="py-1.5 text-right">
                      <button type="button" onClick={() => onEdit(trip)} aria-label="Edit trip" className="rounded p-1 text-slate-300 hover:bg-white/10 hover:text-white"><Pencil className="h-3.5 w-3.5" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-white/20 font-semibold text-slate-200">
              <tr>
                <td className="py-1.5 text-right">{fmtMiles(t.miles)}</td>
                <td className="py-1.5 text-right text-amber-200">{t.excluded ? fmtMiles(t.excluded) : "—"}</td>
                <td />
                <td className="py-1.5 text-right text-white">{fmtMiles(t.eligible)}</td>
                <td colSpan={4} className="py-1.5 pl-3 text-xs font-normal text-slate-400">Car IQ {price.carIq} · {price.rate} / mi · <span className="text-emerald-300">{price.pay}</span></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="flex gap-3 border-t border-white/10 px-6 py-4">
          <button type="button" onClick={onAdd} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"><Plus className="h-4 w-4" /> Add a trip this day</button>
          <button type="button" onClick={onClose} className="ml-auto rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-600">Close</button>
        </div>
      </div>
    </div>
  );
}
