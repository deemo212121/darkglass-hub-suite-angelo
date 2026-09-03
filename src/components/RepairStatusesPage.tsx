import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, Save, Download, Printer, Loader2, X } from "lucide-react";
import type { ModuleDef } from "@/lib/modules";
import { useAllRoleOptions } from "@/lib/customRoles";
import { getRepairStatuses, upsertRepairStatus, deleteRepairStatus, type RepairStatus } from "@/lib/supabase/repairStatuses";

type DraftRow = Omit<RepairStatus, "id" | "sortOrder"> & { id?: string };

const OVERALL_STATUS_OPTIONS = ["Pending", "Ready to Repair", "Completed", "Cancelled"];
const SEARCHABLE_FIELDS: Array<keyof DraftRow> = ["code", "description", "overallStatus", "initialStatus", "followUpDashboard", "servicePowerStatus"];

const blankDraft: DraftRow = {
  code: "",
  description: "",
  overallStatus: "Pending",
  initialStatus: "",
  color: "#888888",
  fontBold: false,
  followUpDashboard: "",
  allowedRoles: [],
  csrRescheduleStatus: false,
  partPendingStatus: false,
  cxRequestsReschedule: false,
  dispatchCompletedStatus: false,
  mobileSearch: false,
  hideInMobile: false,
  servicePowerStatus: "",
};

function ToggleCell({ checked, onToggle, label }: { checked: boolean; onToggle: (value: boolean) => void; label?: string }) {
  return (
    <label className="repair-checkbox-wrap">
      <input type="checkbox" checked={checked} onChange={(event) => onToggle(event.target.checked)} aria-label={label ?? (checked ? "Enabled" : "Disabled")} />
    </label>
  );
}

/** Compact "which roles can use this status" multi-select — a button showing a short summary that opens a checkbox popover, since a full multi-select control doesn't fit in a dense table cell. */
function RoleMultiSelectCell({ values, onChange }: { values: string[]; onChange: (next: string[]) => void }) {
  const roleOptions = useAllRoleOptions();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const toggle = (val: string) => {
    onChange(values.includes(val) ? values.filter((v) => v !== val) : [...values, val]);
  };
  const summary = values.length === 0 ? "— none —" : values.length === 1 ? (roleOptions.find((o) => o.value === values[0])?.label ?? values[0]) : `${values.length} roles`;
  return (
    <div className="role-cell" ref={ref}>
      <button type="button" className="role-cell-btn" onClick={() => setOpen((v) => !v)} title={values.map((v) => roleOptions.find((o) => o.value === v)?.label ?? v).join(", ") || "No roles selected"}>
        {summary}
      </button>
      {open && (
        <div className="role-cell-popover">
          {roleOptions.map((opt) => (
            <label key={opt.value} className="role-cell-option">
              <input type="checkbox" checked={values.includes(opt.value)} onChange={() => toggle(opt.value)} />
              {opt.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function RepairStatusesPage({ mod }: { mod: ModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const [rows, setRows] = useState<RepairStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<DraftRow>(blankDraft);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await getRepairStatuses());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSearch("");
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, []);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (!search) return true;
      const haystack = SEARCHABLE_FIELDS.map((field) => String((row as any)[field] ?? "")).join(" ").toLowerCase();
      return haystack.includes(search.toLowerCase());
    });
  }, [rows, search]);

  const updateRow = (id: string, key: keyof RepairStatus, value: any) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
  };

  const updateDraft = (key: keyof DraftRow, value: any) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const removeRow = async (row: RepairStatus) => {
    if (!window.confirm(`Delete status "${row.code}" (${row.description})?`)) return;
    setSaving(true);
    setError(null);
    try {
      await deleteRepairStatus(row.id);
      setRows((current) => current.filter((r) => r.id !== row.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete status.");
    } finally {
      setSaving(false);
    }
  };

  const saveAll = async () => {
    setSaving(true);
    setError(null);
    try {
      // Every currently-loaded row, plus the draft (if it's been filled in)
      // as a new row — one upsert per row is simplest and cheap at this scale
      // (a couple dozen statuses), rather than diffing what actually changed.
      for (const row of rows) {
        await upsertRepairStatus({ ...row, sortOrder: row.sortOrder });
      }
      if (draft.code.trim() && draft.description.trim()) {
        await upsertRepairStatus({ ...draft, code: draft.code.trim(), description: draft.description.trim(), sortOrder: rows.length });
        setDraft(blankDraft);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1700px] mx-auto w-full px-6 py-8">
        <style>{`
          .panel {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 10px;
            padding: 1.25rem;
            color: #fff;
            backdrop-filter: blur(10px);
          }
          .repair-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.9rem; }
          .repair-title-wrap { display: flex; align-items: center; gap: 0.85rem; }
          .repair-subtitle { color: #cbd5e1; font-size: 0.9rem; }
          .top-actions { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
          .btn {
            height: 34px;
            padding: 0 1rem;
            border-radius: 6px;
            border: 1px solid rgba(255, 255, 255, 0.25);
            background: rgba(17, 24, 39, 0.95);
            color: #fff;
            font-size: 0.86rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.4rem;
          }
          .btn:hover { border-color: rgba(96, 165, 250, 0.7); background: rgba(30, 64, 175, 0.35); }
          .btn.primary { background: #1d4ed8; border-color: #1d4ed8; }
          .btn.primary:hover { background: #1e40af; }
          .btn:disabled { opacity: 0.5; cursor: not-allowed; }
          .status-card { margin-top: 0.75rem; }
          .search-row { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.65rem; }
          .result-info { font-size: 0.8rem; font-weight: 700; color: #bfdbfe; }
          .search-input { width: 260px; height: 34px; padding: 0.35rem 0.5rem; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; font-size: 0.8rem; color: #fff; background: rgba(17, 24, 39, 0.95); }
          .table-wrap { overflow: auto; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 10px; background: #111827; }
          table.status-table { width: 100%; border-collapse: collapse; background: #111827; color: #e5e7eb; font-size: 0.76rem; }
          .status-table th, .status-table td { border: 1px solid rgba(255, 255, 255, 0.12); padding: 0.38rem 0.45rem; white-space: nowrap; text-align: center; vertical-align: middle; }
          .status-table th { background: #4b5563; color: #ffffff; font-weight: 700; position: sticky; top: 0; z-index: 2; }
          .status-table td:first-child, .status-table td:nth-child(2), .status-table td:nth-child(4), .status-table td:nth-child(8) { text-align: left; }
          .status-table input, .status-table select {
            width: 100%;
            min-width: 0;
            height: 28px;
            padding: 0.18rem 0.3rem;
            border: 1px solid #cbd5e1;
            border-radius: 4px;
            background: #fff;
            color: #111827;
            font-size: 0.7rem;
          }
          .status-table input[type="color"] { padding: 2px; cursor: pointer; width: 44px; }
          .status-table input[type="checkbox"] { width: 18px; height: 18px; min-width: 18px; }
          .draft-row { background: #fffdf2; }
          .draft-row td { background: #fffdf2; }
          .role-cell { position: relative; }
          .role-cell-btn { width: 100%; height: 28px; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 4px; background: #1f2937; color: #e5e7eb; font-size: 0.68rem; cursor: pointer; padding: 0 0.3rem; }
          .role-cell-btn:hover { border-color: #94a3b8; }
          .role-cell-popover { position: absolute; z-index: 10; top: 100%; left: 0; margin-top: 2px; width: 220px; max-height: 260px; overflow-y: auto; background: #1f2937; border: 1px solid #94a3b8; border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,0.25); padding: 0.35rem; text-align: left; }
          .role-cell-option { display: flex; align-items: center; gap: 0.4rem; padding: 0.2rem 0.3rem; font-size: 0.72rem; color: #e5e7eb; cursor: pointer; white-space: nowrap; }
          .role-cell-option:hover { background: #374151; border-radius: 4px; }
          .role-cell-option input { width: 14px; height: 14px; min-width: 14px; }
          .group-head { background: #4b5563; font-weight: 700; }
          .notes { margin-top: 0.9rem; color: #cbd5e1; font-size: 0.82rem; line-height: 1.4; }
          .action-cell { display: flex; gap: 0.45rem; justify-content: center; }
          .delete-btn { border: 0; background: transparent; color: #1d4ed8; font-weight: 700; cursor: pointer; padding: 0; }
          .delete-btn:hover { text-decoration: underline; }
          .link-btn { border: 0; background: transparent; color: #1d4ed8; font-weight: 700; cursor: pointer; padding: 0; }
          .link-btn:hover { text-decoration: underline; }
          .toolbar-icon { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; color: #14a6e2; border: 0; background: transparent; cursor: pointer; }
          .toolbar-icon:hover { color: #0ea5e9; }
          .toolbar-search { display: inline-flex; align-items: center; gap: 0.35rem; border: 2px solid #4f46e5; border-radius: 999px; padding: 0.15rem 0.55rem; background: #1f2937; }
          .toolbar-search input { border: 0; outline: none; width: 170px; font-size: 0.72rem; background: transparent; color: #e5e7eb; }
          .top-right-tools { display: flex; align-items: center; gap: 0.25rem; }
          @media (max-width: 1100px) { .search-input { width: 100%; } }
        `}</style>

        <div className="repair-toolbar">
          <div className="repair-title-wrap">
            <button type="button" onClick={goBack} className="btn">
              <ChevronLeft className="h-4 w-4" /> {mod.label}
            </button>
            <div>
              <div className="text-4xl font-display font-bold tracking-tight">Repair Statuses</div>
              <div className="repair-subtitle">{filteredRows.length} records found</div>
            </div>
          </div>

          <div className="top-actions">
            <div className="top-right-tools">
              <button type="button" className="toolbar-icon" aria-label="Print" onClick={() => window.print()}><Printer className="h-4 w-4" /></button>
              <button
                type="button"
                className="toolbar-icon"
                aria-label="Download"
                onClick={() => {
                  const csv = [
                    ["Code", "Description", "Overall Status", "Initial Status", "Color", "Roles"].join(","),
                    ...rows.map((r) => [r.code, r.description, r.overallStatus, r.initialStatus, r.color, r.allowedRoles.join(" ")].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")),
                  ].join("\n");
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "repair-statuses.csv";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download className="h-4 w-4" />
              </button>
            </div>
            <div className="toolbar-search">
              <input type="text" placeholder="search in result" value={search} onChange={(event) => setSearch(event.target.value)} />
              <button type="button" className="toolbar-icon" aria-label="Clear search" onClick={() => setSearch("")}> <X className="h-4 w-4" /> </button>
            </div>
            <button type="button" className="btn primary" onClick={saveAll} disabled={saving || loading}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        <div className="panel status-card">
          {error && (
            <div className="mb-3 text-sm rounded-lg p-3 border border-red-500/40 bg-red-500/10 text-red-300">{error}</div>
          )}
          {loading ? (
            <div className="py-16 text-center text-slate-300">Loading…</div>
          ) : (
            <div className="table-wrap">
              <table className="status-table">
                <thead>
                  <tr className="group-head">
                    <th>Code</th>
                    <th>Description</th>
                    <th>Overall Status</th>
                    <th>Initial Status</th>
                    <th>Color</th>
                    <th>Font Bold</th>
                    <th>Follow-up Dashboard</th>
                    <th>Who Can Use This Status</th>
                    <th>CSR Reschedule Status</th>
                    <th>Part Pending Status</th>
                    <th>When Cx Requests Reschedule</th>
                    <th>Dispatch Completed Status</th>
                    <th>Mobile Search</th>
                    <th>Hide in Mobile</th>
                    <th>Service Power Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="draft-row">
                    <td><input value={draft.code} onChange={(event) => updateDraft("code", event.target.value)} placeholder="Code" /></td>
                    <td><input value={draft.description} onChange={(event) => updateDraft("description", event.target.value)} placeholder="Description" /></td>
                    <td>
                      <select value={draft.overallStatus} onChange={(event) => updateDraft("overallStatus", event.target.value)}>
                        {OVERALL_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </td>
                    <td><input value={draft.initialStatus} onChange={(event) => updateDraft("initialStatus", event.target.value)} placeholder="Initial status" /></td>
                    <td><input type="color" value={draft.color} onChange={(event) => updateDraft("color", event.target.value)} /></td>
                    <td><ToggleCell checked={draft.fontBold} onToggle={(value) => updateDraft("fontBold", value)} /></td>
                    <td><input value={draft.followUpDashboard} onChange={(event) => updateDraft("followUpDashboard", event.target.value)} placeholder="Follow-up dashboard" /></td>
                    <td><RoleMultiSelectCell values={draft.allowedRoles} onChange={(v) => updateDraft("allowedRoles", v)} /></td>
                    <td><ToggleCell checked={draft.csrRescheduleStatus} onToggle={(value) => updateDraft("csrRescheduleStatus", value)} /></td>
                    <td><ToggleCell checked={draft.partPendingStatus} onToggle={(value) => updateDraft("partPendingStatus", value)} /></td>
                    <td><ToggleCell checked={draft.cxRequestsReschedule} onToggle={(value) => updateDraft("cxRequestsReschedule", value)} /></td>
                    <td><ToggleCell checked={draft.dispatchCompletedStatus} onToggle={(value) => updateDraft("dispatchCompletedStatus", value)} /></td>
                    <td><ToggleCell checked={draft.mobileSearch} onToggle={(value) => updateDraft("mobileSearch", value)} /></td>
                    <td><ToggleCell checked={draft.hideInMobile} onToggle={(value) => updateDraft("hideInMobile", value)} /></td>
                    <td><input value={draft.servicePowerStatus} onChange={(event) => updateDraft("servicePowerStatus", event.target.value)} placeholder="e.g. ACCEPTED" /></td>
                    <td className="action-cell"><span className="link-btn" onClick={saveAll}>Add</span></td>
                  </tr>

                  {filteredRows.map((row) => (
                    <tr key={row.id}>
                      <td><input value={row.code} onChange={(event) => updateRow(row.id, "code", event.target.value)} /></td>
                      <td><input value={row.description} onChange={(event) => updateRow(row.id, "description", event.target.value)} /></td>
                      <td>
                        <select value={row.overallStatus} onChange={(event) => updateRow(row.id, "overallStatus", event.target.value)}>
                          {OVERALL_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      </td>
                      <td><input value={row.initialStatus} onChange={(event) => updateRow(row.id, "initialStatus", event.target.value)} /></td>
                      <td><input type="color" value={row.color} onChange={(event) => updateRow(row.id, "color", event.target.value)} /></td>
                      <td><ToggleCell checked={row.fontBold} onToggle={(value) => updateRow(row.id, "fontBold", value)} /></td>
                      <td><input value={row.followUpDashboard} onChange={(event) => updateRow(row.id, "followUpDashboard", event.target.value)} /></td>
                      <td><RoleMultiSelectCell values={row.allowedRoles} onChange={(v) => updateRow(row.id, "allowedRoles", v)} /></td>
                      <td><ToggleCell checked={row.csrRescheduleStatus} onToggle={(value) => updateRow(row.id, "csrRescheduleStatus", value)} /></td>
                      <td><ToggleCell checked={row.partPendingStatus} onToggle={(value) => updateRow(row.id, "partPendingStatus", value)} /></td>
                      <td><ToggleCell checked={row.cxRequestsReschedule} onToggle={(value) => updateRow(row.id, "cxRequestsReschedule", value)} /></td>
                      <td><ToggleCell checked={row.dispatchCompletedStatus} onToggle={(value) => updateRow(row.id, "dispatchCompletedStatus", value)} /></td>
                      <td><ToggleCell checked={row.mobileSearch} onToggle={(value) => updateRow(row.id, "mobileSearch", value)} /></td>
                      <td><ToggleCell checked={row.hideInMobile} onToggle={(value) => updateRow(row.id, "hideInMobile", value)} /></td>
                      <td><input value={row.servicePowerStatus} onChange={(event) => updateRow(row.id, "servicePowerStatus", event.target.value)} /></td>
                      <td className="action-cell">
                        <span className="link-btn" onClick={() => removeRow(row)}>Delete</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="notes">
            <p>* "Who Can Use This Status" is a saved reference for now — it isn't yet enforced on ticket status dropdowns elsewhere in the app.</p>
            <p>* RDCN (Redo Cancel): use this when reporting cancelled to manufacturer but counting it as completed by technician.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
