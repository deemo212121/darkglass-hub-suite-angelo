import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, Loader2, CheckCircle2, CircleDashed } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import {
  getExternalServiceAccounts,
  upsertExternalServiceAccount,
  deleteExternalServiceAccount,
  type ExternalServiceAccountRow as AccountRow,
} from "@/lib/supabase/externalServiceAccounts";

const ACCOUNT_TYPE_OPTIONS = [
  "American Home Shield Account",
  "Encompass",
  "LG",
  "Marcone",
  "Marcone (New APD)",
  "Midea Account",
  "National Service Alliance",
  "Open Phone",
  "Reliable Pars",
  "Ring Central",
  "Samsung GSPN Account",
  "Service Bench Account",
  "Service Power Account",
  "Square",
  "TWillO",
] as const;

const isPersisted = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
let tempIdSeq = 0;
const newTempId = () => `new-${Date.now()}-${tempIdSeq++}`;

// Pre-migration, this page stored everything in this browser's
// localStorage only — invisible to Supabase and to any other admin. Rows
// added here (e.g. a real NSA/Marcone/Encompass account) before the
// Supabase cutover are still sitting under this key in whichever browser
// they were added from; they just aren't rendered anymore since the page
// now reads from Supabase. One-time recovery check below offers to import
// them rather than leaving that data silently stranded.
const LEGACY_STORAGE_KEY = "ahs:external-accounts";
const LEGACY_DISMISSED_KEY = "ahs:external-accounts:import-dismissed";

function loadLegacyRows(): AccountRow[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { rows?: Array<Record<string, unknown>> };
    if (!Array.isArray(parsed.rows)) return [];
    return parsed.rows
      .filter((row) => row && typeof row === "object")
      .map((row): AccountRow => ({
        id: newTempId(),
        type: typeof row.type === "string" && row.type ? row.type : "American Home Shield Account",
        accountNo: typeof row.accountNo === "string" ? row.accountNo : "",
        displayName: typeof row.displayName === "string" ? row.displayName : "",
        accountId: typeof row.accountId === "string" ? row.accountId : "",
        password: typeof row.password === "string" ? row.password : "",
        refNo1: typeof row.refNo1 === "string" ? row.refNo1 : "",
        defaultPartDist: typeof row.defaultPartDist === "string" ? row.defaultPartDist : "",
        sync: typeof row.sync === "string" ? row.sync : "",
      }))
      // Only worth recovering if it has real, filled-in data beyond the
      // bare type/account-no the hardcoded seed already covers.
      .filter((row) => row.accountId.trim() || row.password.trim() || row.displayName.trim());
  } catch {
    return [];
  }
}

const blankRow = (): AccountRow => ({
  id: newTempId(),
  type: "American Home Shield Account",
  accountNo: "",
  displayName: "",
  accountId: "",
  password: "",
  refNo1: "",
  defaultPartDist: "",
  sync: "",
});

export function AccountManagementPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: mod.slug } }));
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [savedRows, setSavedRows] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSavePrompt, setShowSavePrompt] = useState(false);

  const [recoverable, setRecoverable] = useState<AccountRow[]>([]);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getExternalServiceAccounts()
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        setSavedRows(data);

        if (typeof window !== "undefined" && !window.localStorage.getItem(LEGACY_DISMISSED_KEY)) {
          const legacy = loadLegacyRows();
          // Only flag rows this browser has that aren't already an exact
          // match in Supabase — avoids re-suggesting the two seeded
          // defaults if this browser's copy of them is identical.
          const alreadyKnown = new Set(
            data.map((r) => `${r.type}|${r.accountNo}|${r.displayName}|${r.accountId}|${r.password}|${r.refNo1}|${r.defaultPartDist}`)
          );
          const fresh = legacy.filter(
            (r) => !alreadyKnown.has(`${r.type}|${r.accountNo}|${r.displayName}|${r.accountId}|${r.password}|${r.refNo1}|${r.defaultPartDist}`)
          );
          if (fresh.length > 0) setRecoverable(fresh);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load accounts");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const importRecovered = async () => {
    setImporting(true);
    try {
      await Promise.all(recoverable.map((row) => upsertExternalServiceAccount(row)));
      const fresh = await getExternalServiceAccounts();
      setRows(fresh);
      setSavedRows(fresh);
      setRecoverable([]);
      window.localStorage.setItem(LEGACY_DISMISSED_KEY, "1");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to import recovered accounts");
    } finally {
      setImporting(false);
    }
  };

  const dismissRecovery = () => {
    setRecoverable([]);
    window.localStorage.setItem(LEGACY_DISMISSED_KEY, "1");
  };

  const hasUnsavedChanges = useMemo(() => JSON.stringify(rows) !== JSON.stringify(savedRows), [rows, savedRows]);

  const addRow = () => {
    setRows((current) => [...current, blankRow()]);
  };

  const deleteRow = (rowId: string) => {
    setRows((current) => current.filter((row) => row.id !== rowId));
  };

  const saveChanges = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const removedIds = savedRows
        .filter((saved) => isPersisted(saved.id) && !rows.some((r) => r.id === saved.id))
        .map((r) => r.id);
      await Promise.all(removedIds.map((id) => deleteExternalServiceAccount(id)));
      await Promise.all(rows.map((row) => upsertExternalServiceAccount(row)));
      const fresh = await getExternalServiceAccounts();
      setRows(fresh);
      setSavedRows(fresh);
      setShowSavePrompt(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save accounts");
    } finally {
      setSaving(false);
    }
  };

  const requestSave = () => {
    if (!hasUnsavedChanges) return;
    setShowSavePrompt(true);
  };

  return (
    <main className="flex-1 bg-slate-950 py-6">
      <div className="max-w-[1500px] mx-auto px-6">
        <div className="flex items-center gap-3 text-white">
          <button type="button" onClick={goBack} className="btn">
            <ChevronLeft className="h-4 w-4" />
            {mod.label}
          </button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{sub.title}</h1>
            <p className="mt-1 text-sm text-slate-300">{sub.description}</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button type="button" onClick={addRow} className="btn" disabled={loading}>Add</button>
          <button type="button" onClick={requestSave} disabled={!hasUnsavedChanges || saving} className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-2">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save Accounts
          </button>
          {saveError && <span className="text-xs text-red-400">Save failed: {saveError}</span>}
        </div>

        {loadError && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            Failed to load accounts: {loadError}
          </div>
        )}

        {recoverable.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <p className="font-medium">
              Found {recoverable.length} account{recoverable.length === 1 ? "" : "s"} saved in this browser from before this page moved to shared storage:{" "}
              {recoverable.map((r) => r.type).join(", ")}.
            </p>
            <p className="mt-1 text-amber-200/80">This only checks the browser you're using right now — if these accounts were added from a different computer, they won't show up here.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => void importRecovered()} disabled={importing} className="btn btn-primary flex items-center gap-2">
                {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {importing ? "Importing…" : `Import ${recoverable.length} account${recoverable.length === 1 ? "" : "s"}`}
              </button>
              <button type="button" onClick={dismissRecovery} disabled={importing} className="btn">Dismiss</button>
            </div>
          </div>
        )}

        <div className="mt-5 overflow-x-auto rounded-xl border border-white/15 bg-slate-950/60">
            <table className="min-w-[950px] w-full text-xs">
              <thead>
                <tr className="bg-slate-900/90 text-blue-200">
                  <th className="px-2 py-1.5 text-left">Type*</th>
                  <th className="px-2 py-1.5 text-left">Account No*</th>
                  <th className="px-2 py-1.5 text-left">Display Name*</th>
                  <th className="px-2 py-1.5 text-left">ID*</th>
                  <th className="px-2 py-1.5 text-left">Password*</th>
                  <th className="px-2 py-1.5 text-left">Ref No 1</th>
                  <th className="px-2 py-1.5 text-left">Default Part Dist.</th>
                  <th className="px-2 py-1.5 text-left">Sync</th>
                  <th className="px-2 py-1.5 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 text-slate-200">
                {loading ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Loading accounts…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No accounts yet — click Add to create one.</td></tr>
                ) : rows.map((row, index) => (
                  <tr key={row.id} className={index % 2 === 0 ? "bg-white/[0.02]" : "bg-white/[0.04]"}>
                    <td className="px-2 py-1.5 align-middle">
                      <select
                        value={row.type}
                        onChange={(event) => setRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, type: event.target.value } : entry))}
                        title="Type"
                        aria-label="Type"
                        className="glass-input w-full min-w-[130px] text-xs"
                      >
                        {ACCOUNT_TYPE_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5 align-middle">
                      <input
                        value={row.accountNo}
                        onChange={(event) => setRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, accountNo: event.target.value } : entry))}
                        title="Account No"
                        placeholder="Account No"
                        className="glass-input w-full min-w-[90px] text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5 align-middle">
                      <input
                        value={row.displayName}
                        onChange={(event) => setRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, displayName: event.target.value } : entry))}
                        title="Display Name"
                        placeholder="Display Name"
                        className="glass-input w-full min-w-[160px] text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5 align-middle">
                      <input
                        value={row.accountId}
                        onChange={(event) => setRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, accountId: event.target.value } : entry))}
                        title="ID"
                        placeholder="ID"
                        autoComplete="off"
                        className="glass-input w-full min-w-[80px] text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5 align-middle">
                      <input
                        type="password"
                        value={row.password}
                        onChange={(event) => setRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, password: event.target.value } : entry))}
                        title="Password"
                        placeholder="Password"
                        autoComplete="new-password"
                        className="glass-input w-full min-w-[80px] text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5 align-middle">
                      <input
                        value={row.refNo1}
                        onChange={(event) => setRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, refNo1: event.target.value } : entry))}
                        title="Ref No 1"
                        placeholder="Ref No 1"
                        className="glass-input w-full min-w-[90px] text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5 align-middle">
                      <input
                        value={row.defaultPartDist}
                        onChange={(event) => setRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, defaultPartDist: event.target.value } : entry))}
                        title="Default Part Dist."
                        placeholder="Default Part Dist."
                        className="glass-input w-full min-w-[110px] text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5 align-middle">
                      {row.accountId.trim() && row.password.trim() ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[11px] font-medium text-green-300" title="ID and Password are both filled in">
                          <CheckCircle2 className="h-3 w-3" /> Configured
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-slate-400" title="Missing ID and/or Password">
                          <CircleDashed className="h-3 w-3" /> Not configured
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 align-middle">
                      <button type="button" onClick={() => deleteRow(row.id)} className="btn">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      {showSavePrompt && hasUnsavedChanges && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-slate-900 p-5 text-white shadow-2xl">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Unsaved account changes</div>
            <h2 className="mt-2 text-xl font-semibold">Save these account records?</h2>
            <p className="mt-2 text-sm text-slate-300">
              The external account rows were modified. Save now to keep the updated account mappings.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={() => void saveChanges()} disabled={saving} className="btn btn-primary flex items-center gap-2">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {saving ? "Saving…" : "Save now"}
              </button>
              <button type="button" onClick={() => setShowSavePrompt(false)} disabled={saving} className="btn">Keep editing</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
