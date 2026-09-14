/**
 * Company Holidays — editable per-year holiday list, seeded from the U.S.
 * federal holiday calendar (usFederalHolidays.ts) but every row is a plain
 * editable date once created (see migration 0252), so HR can move a
 * specific year's observed date without touching any other year.
 *
 * One shared calendar for everyone — Philippines staff follow the same
 * U.S. holiday list rather than their own (per HR's explicit call), so
 * there's no per-country toggle here even though the underlying table
 * still has a `country` column (always written as "US").
 *
 * Read by Absent List, Time Off Calendar, and Attendance Monitoring
 * (excludes a holiday date from "who's missing a clock-in" the same way a
 * rest day already is). Payroll integration is intentionally limited to
 * this reference calendar — pay is already driven by actual clocked
 * hours, so no separate holiday-pay calculation was needed.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2, Pencil, Check } from "lucide-react";
import {
  getCompanyHolidays,
  addCompanyHoliday,
  addCompanyHolidays,
  updateCompanyHoliday,
  deleteCompanyHoliday,
  type CompanyHolidayRow,
} from "@/lib/supabase/companyHolidays";
import { usFederalHolidaysForYear } from "@/lib/usFederalHolidays";

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function HolidayCalendarTab({ myProfileId }: { myProfileId: string | null }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [holidays, setHolidays] = useState<CompanyHolidayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    getCompanyHolidays(year)
      .then(setHolidays)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load holidays."))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const visibleHolidays = useMemo(() => [...holidays].sort((a, b) => a.date.localeCompare(b.date)), [holidays]);

  const handleSeedUsFederal = async () => {
    setSeeding(true);
    setError(null);
    try {
      const defaults = usFederalHolidaysForYear(year);
      await addCompanyHolidays(defaults.map((d) => ({ year, country: "US", name: d.name, date: d.date, isCustom: false, createdBy: myProfileId })));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add federal holidays.");
    } finally {
      setSeeding(false);
    }
  };

  const [addingName, setAddingName] = useState("");
  const [addingDate, setAddingDate] = useState("");
  const [saving, setSaving] = useState(false);
  const handleAddHoliday = async () => {
    if (!addingName.trim() || !addingDate) return;
    setSaving(true);
    setError(null);
    try {
      const created = await addCompanyHoliday({ year, country: "US", name: addingName.trim(), date: addingDate, isCustom: true, createdBy: myProfileId });
      setHolidays((prev) => [...prev, created]);
      setAddingName("");
      setAddingDate("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add holiday.");
    } finally {
      setSaving(false);
    }
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ name: string; date: string }>({ name: "", date: "" });
  const startEdit = (h: CompanyHolidayRow) => {
    setEditingId(h.id);
    setEditDraft({ name: h.name, date: h.date });
  };
  const handleSaveEdit = async (id: string) => {
    setSaving(true);
    setError(null);
    try {
      await updateCompanyHoliday(id, editDraft);
      setHolidays((prev) => prev.map((h) => (h.id === id ? { ...h, name: editDraft.name, date: editDraft.date } : h)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Remove "${name}" from ${year}'s holiday calendar?`)) return;
    try {
      await deleteCompanyHoliday(id);
      setHolidays((prev) => prev.filter((h) => h.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete.");
    }
  };

  return (
    <div className="panel">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setYear((y) => y - 1)} className="btn p-1.5"><ChevronLeft className="h-4 w-4" /></button>
          <span className="text-lg font-semibold w-16 text-center">{year}</span>
          <button type="button" onClick={() => setYear((y) => y + 1)} className="btn p-1.5"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-muted-foreground">Applies company-wide — U.S. and Philippines staff share this same calendar.</p>
      </div>

      {error && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 mb-3">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
      ) : (
        <>
          {visibleHolidays.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-6 border border-dashed border-white/10 rounded-md mb-4">
              <p className="mb-2">No holidays on file for {year}.</p>
              <button type="button" onClick={() => void handleSeedUsFederal()} disabled={seeding} className="btn text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
                {seeding ? "Adding…" : `Add U.S. Federal Holidays for ${year}`}
              </button>
            </div>
          )}

          {visibleHolidays.length > 0 && (
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 border-b border-white/10 text-left">
                    <th className="py-2 pr-3">Holiday</th>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 w-20">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleHolidays.map((h) => (
                    <tr key={h.id} className="border-b border-white/5">
                      <td className="py-2 pr-3">
                        {editingId === h.id ? (
                          <input
                            type="text"
                            value={editDraft.name}
                            onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                            className="glass-input text-sm py-1 px-2 rounded-md w-full"
                          />
                        ) : (
                          <span className="text-white">{h.name}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-slate-300 whitespace-nowrap">
                        {editingId === h.id ? (
                          <input
                            type="date"
                            value={editDraft.date}
                            onChange={(e) => setEditDraft({ ...editDraft, date: e.target.value })}
                            className="glass-input text-sm py-1 px-2 rounded-md"
                          />
                        ) : (
                          formatDate(h.date)
                        )}
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          {editingId === h.id ? (
                            <button type="button" onClick={() => void handleSaveEdit(h.id)} disabled={saving} className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40">
                              <Check className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <button type="button" onClick={() => startEdit(h)} className="text-muted-foreground hover:text-white">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button type="button" onClick={() => void handleDelete(h.id, h.name)} className="text-red-400 hover:text-red-300">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2 pt-3 border-t border-white/10">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Holiday name</label>
              <input
                type="text"
                value={addingName}
                onChange={(e) => setAddingName(e.target.value)}
                placeholder="e.g. Company Anniversary"
                className="glass-input text-sm py-1.5 px-3 rounded-md"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Date</label>
              <input type="date" value={addingDate} onChange={(e) => setAddingDate(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
            </div>
            <button
              type="button"
              onClick={() => void handleAddHoliday()}
              disabled={!addingName.trim() || !addingDate || saving}
              className="btn text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 flex items-center gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" /> Add Holiday
            </button>
          </div>
        </>
      )}
    </div>
  );
}
