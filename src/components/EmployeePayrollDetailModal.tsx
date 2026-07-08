import { useEffect, useMemo, useState } from "react";
import { X, Plus } from "lucide-react";
import { getAttendanceForRange, type AttendanceRow } from "@/lib/supabase/timecards";
import {
  getSalaryHistory,
  addSalaryEntry,
  rateEffectiveOn,
  currentRate,
  type SalaryEntryRow,
  type SalaryChangeReason,
} from "@/lib/supabase/salary";

interface Props {
  profileId: string;
  employeeName: string;
  department?: string;
  requiredCheckIn?: string;
  requiredCheckOut?: string;
  offDays?: number[];
  onClose: () => void;
  /** Called after a rate change is saved, so the caller can refresh its own aggregate payroll view. */
  onRateChanged?: () => void;
}

function monthBounds(monthStr: string): { start: string; end: string } {
  const [y, m] = monthStr.split("-").map(Number);
  const start = `${monthStr}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${monthStr}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

const STATUS_LABEL: Record<AttendanceRow["status"], string> = {
  present: "Present",
  absent: "Absent",
  "missing-in": "Missing Clock In",
  "missing-out": "Missing Clock Out",
};
const STATUS_COLOR: Record<AttendanceRow["status"], string> = {
  present: "text-green-300",
  absent: "text-red-300",
  "missing-in": "text-yellow-300",
  "missing-out": "text-yellow-300",
};

export function EmployeePayrollDetailModal({
  profileId,
  employeeName,
  department,
  requiredCheckIn,
  requiredCheckOut,
  offDays,
  onClose,
  onRateChanged,
}: Props) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [history, setHistory] = useState<SalaryEntryRow[]>([]);
  const [showRateForm, setShowRateForm] = useState(false);
  const [rateForm, setRateForm] = useState({
    effectiveDate: new Date().toISOString().slice(0, 10),
    hourlyRate: "",
    reason: "adjustment" as SalaryChangeReason,
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  // Per-day rate overrides pending save, keyed by date ("YYYY-MM-DD") — the
  // input's raw string value while the user is editing it.
  const [rateEdits, setRateEdits] = useState<Record<string, string>>({});
  const [savingRates, setSavingRates] = useState(false);

  const load = async () => {
    setLoading(true);
    setRateEdits({});
    try {
      const { start, end } = monthBounds(month);
      const [attRows, hist] = await Promise.all([
        getAttendanceForRange(profileId, start, end, { requiredCheckIn, requiredCheckOut, daysOff: offDays }),
        getSalaryHistory(profileId),
      ]);
      setAttendance(attRows);
      setHistory(hist);
    } catch (err) {
      console.error("Failed to load employee payroll detail:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, month]);

  const totalHours = useMemo(() => attendance.reduce((s, r) => s + r.hoursWorked, 0), [attendance]);
  const warnings = useMemo(() => attendance.filter((r) => r.status !== "present"), [attendance]);
  // Each day's hours are paid at whichever rate was effective ON that day —
  // so a mid-month raise/promotion is handled automatically instead of
  // needing one flat rate for the whole period.
  const computedPay = useMemo(
    () => attendance.reduce((s, r) => s + r.hoursWorked * rateEffectiveOn(history, r.date), 0),
    [attendance, history]
  );
  const rateNow = useMemo(() => currentRate(history), [history]);

  const submitRateChange = async () => {
    const rate = Number(rateForm.hourlyRate);
    if (!rateForm.effectiveDate || !Number.isFinite(rate) || rate <= 0) {
      alert("Please enter a valid effective date and hourly rate.");
      return;
    }
    setSaving(true);
    try {
      await addSalaryEntry({
        profileId,
        effectiveDate: rateForm.effectiveDate,
        hourlyRate: rate,
        reason: rateForm.reason,
        notes: rateForm.notes,
      });
      setHistory(await getSalaryHistory(profileId));
      setShowRateForm(false);
      setRateForm({ effectiveDate: new Date().toISOString().slice(0, 10), hourlyRate: "", reason: "adjustment", notes: "" });
      onRateChanged?.();
    } catch (err) {
      alert(`Failed to save rate change: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  const handleRateEdit = (date: string, value: string) => {
    setRateEdits((prev) => ({ ...prev, [date]: value }));
  };

  // Only edits that actually differ from the currently-effective rate count
  // as pending — so the Save button doesn't light up for a no-op edit.
  const pendingRateChanges = useMemo(() => {
    const changes: Array<{ date: string; rate: number }> = [];
    for (const [date, value] of Object.entries(rateEdits)) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) continue;
      if (parsed !== rateEffectiveOn(history, date)) changes.push({ date, rate: parsed });
    }
    return changes;
  }, [rateEdits, history]);

  // Each edited day becomes a new dated rate-history entry effective on that
  // day — same mechanism as "Add Rate Change" above, just edited inline.
  // Because rates apply forward until superseded, this changes pay from
  // that date onward (not just the single day) unless a later entry already
  // exists to take back over.
  const handleSaveRateEdits = async () => {
    if (pendingRateChanges.length === 0) return;
    setSavingRates(true);
    try {
      const sorted = [...pendingRateChanges].sort((a, b) => a.date.localeCompare(b.date));
      for (const change of sorted) {
        await addSalaryEntry({
          profileId,
          effectiveDate: change.date,
          hourlyRate: change.rate,
          reason: "adjustment",
          notes: "Edited from Attendance table",
        });
      }
      setHistory(await getSalaryHistory(profileId));
      setRateEdits({});
      onRateChanged?.();
    } catch (err) {
      alert(`Failed to save rate changes: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingRates(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-slate-900 border border-white/15 rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-slate-950 rounded-t-xl">
          <div>
            <p className="font-semibold text-white">{employeeName}</p>
            {department && <p className="text-xs text-slate-400">{department}</p>}
          </div>
          <div className="flex items-center gap-3">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="bg-slate-800 border border-white/10 rounded px-2 py-1 text-sm text-white"
            />
            <button onClick={onClose} className="text-white/40 hover:text-white/80 transition">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-slate-800/50 border border-white/10 rounded-lg p-3">
              <p className="text-xs text-slate-400 uppercase">Total Hours</p>
              <p className="text-xl font-bold text-white mt-1">{totalHours.toFixed(1)}</p>
            </div>
            <div className="bg-slate-800/50 border border-white/10 rounded-lg p-3">
              <p className="text-xs text-slate-400 uppercase">Warnings</p>
              <p className="text-xl font-bold text-yellow-300 mt-1">{warnings.length}</p>
            </div>
            <div className="bg-slate-800/50 border border-white/10 rounded-lg p-3">
              <p className="text-xs text-slate-400 uppercase">Current Rate</p>
              <p className="text-xl font-bold text-white mt-1">${rateNow.toFixed(2)}/hr</p>
            </div>
            <div className="bg-slate-800/50 border border-white/10 rounded-lg p-3">
              <p className="text-xs text-slate-400 uppercase">Est. Pay ({month})</p>
              <p className="text-xl font-bold text-green-300 mt-1">${computedPay.toFixed(2)}</p>
            </div>
          </div>

          {/* Salary history + add change */}
          <div className="bg-slate-800/30 border border-white/10 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">Salary History</h3>
              <button
                onClick={() => setShowRateForm((v) => !v)}
                className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1"
              >
                <Plus className="h-3 w-3" /> Add Rate Change
              </button>
            </div>
            {showRateForm && (
              <div className="mb-4 grid gap-2 md:grid-cols-4 items-end bg-slate-900/60 border border-white/10 rounded-lg p-3">
                <div>
                  <label className="block text-[10px] text-slate-400 uppercase mb-1">Effective Date</label>
                  <input
                    type="date"
                    value={rateForm.effectiveDate}
                    onChange={(e) => setRateForm({ ...rateForm, effectiveDate: e.target.value })}
                    className="w-full bg-slate-800 border border-white/10 rounded px-2 py-1 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 uppercase mb-1">New Rate ($/hr)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={rateForm.hourlyRate}
                    onChange={(e) => setRateForm({ ...rateForm, hourlyRate: e.target.value })}
                    className="w-full bg-slate-800 border border-white/10 rounded px-2 py-1 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 uppercase mb-1">Reason</label>
                  <select
                    value={rateForm.reason}
                    onChange={(e) => setRateForm({ ...rateForm, reason: e.target.value as SalaryChangeReason })}
                    className="w-full bg-slate-800 border border-white/10 rounded px-2 py-1 text-sm text-white"
                  >
                    <option value="promotion">Promotion</option>
                    <option value="adjustment">Adjustment</option>
                    <option value="demotion">Demotion</option>
                    <option value="initial">Initial</option>
                  </select>
                </div>
                <button
                  onClick={submitRateChange}
                  disabled={saving}
                  className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-semibold"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            )}
            {history.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-3">No rate history recorded yet.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-white/10">
                    <th className="text-left py-1.5">Effective</th>
                    <th className="text-left py-1.5">Reason</th>
                    <th className="text-right py-1.5">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-b border-white/5">
                      <td className="py-1.5 text-slate-200">{h.effectiveDate}</td>
                      <td className="py-1.5 text-slate-300 capitalize">{h.reason}</td>
                      <td className="py-1.5 text-right text-white font-semibold">${h.hourlyRate.toFixed(2)}/hr</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Attendance table */}
          <div className="bg-slate-800/30 border border-white/10 rounded-lg p-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-white">Attendance — {month}</h3>
              {pendingRateChanges.length > 0 && (
                <button
                  type="button"
                  onClick={handleSaveRateEdits}
                  disabled={savingRates}
                  className="text-xs px-2 py-1 rounded bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white flex items-center gap-1"
                >
                  {savingRates ? "Saving…" : `Save Rate Changes (${pendingRateChanges.length})`}
                </button>
              )}
            </div>
            <p className="text-[10px] text-slate-500 mb-2">
              Editing a day's rate adds a new rate effective from that date forward (it also applies to later days, until the next rate change).
            </p>
            {loading ? (
              <p className="text-xs text-slate-400 text-center py-4">Loading…</p>
            ) : attendance.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-4">No attendance records for this month.</p>
            ) : (
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-800">
                    <tr className="text-slate-400 border-b border-white/10">
                      <th className="text-left py-1.5">Date</th>
                      <th className="text-left py-1.5">Check In</th>
                      <th className="text-left py-1.5">Check Out</th>
                      <th className="text-right py-1.5">Hours</th>
                      <th className="text-right py-1.5">Rate</th>
                      <th className="text-right py-1.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendance.map((row) => (
                      <tr key={row.date} className="border-b border-white/5">
                        <td className="py-1.5 text-slate-200">{row.date}</td>
                        <td className="py-1.5 text-slate-300">{row.clockIn || "—"}</td>
                        <td className="py-1.5 text-slate-300">{row.clockOut || "—"}</td>
                        <td className="py-1.5 text-right text-slate-200">{row.hoursWorked ? row.hoursWorked.toFixed(1) : "—"}</td>
                        <td className="py-1.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-slate-500">$</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              title={`Rate effective ${row.date}`}
                              value={rateEdits[row.date] ?? rateEffectiveOn(history, row.date).toFixed(2)}
                              onChange={(e) => handleRateEdit(row.date, e.target.value)}
                              className="w-16 bg-slate-900 border border-white/10 rounded px-1.5 py-0.5 text-right text-slate-100 focus:outline-none focus:border-blue-500"
                            />
                          </div>
                        </td>
                        <td className={`py-1.5 text-right font-semibold ${STATUS_COLOR[row.status]}`}>{STATUS_LABEL[row.status]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
