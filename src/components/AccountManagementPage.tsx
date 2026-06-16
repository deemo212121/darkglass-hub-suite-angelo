import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

type AccountRow = {
  id: string;
  type: string;
  accountNo: string;
  displayName: string;
  accountId: string;
  password: string;
  refNo1: string;
  defaultPartDist: string;
  sync: string;
};

const STORAGE_KEY = "ahs:external-accounts";
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

function buildDefaultRows(): AccountRow[] {
  return [
    {
      id: "account-row-1",
      type: "American Home Shield Account",
      accountNo: "SHAWA11215713",
      displayName: "SHAWA11215713 - SHAW,RICO",
      accountId: "",
      password: "",
      refNo1: "",
      defaultPartDist: "",
      sync: "",
    },
    {
      id: "account-row-2",
      type: "Service Power Account",
      accountNo: "1290884",
      displayName: "",
      accountId: "",
      password: "",
      refNo1: "GE_Memphis",
      defaultPartDist: "",
      sync: "",
    },
  ];
}

function loadRows() {
  if (typeof window === "undefined") return buildDefaultRows();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return buildDefaultRows();

  try {
    const parsed = JSON.parse(raw) as { rows?: AccountRow[] };
    if (!Array.isArray(parsed.rows)) return buildDefaultRows();
    return parsed.rows
      .filter((row): row is AccountRow => Boolean(row && row.id))
      .map((row, index) => ({
        id: row.id || `account-row-${index + 1}`,
        type: typeof row.type === "string" && row.type ? row.type : "American Home Shield Account",
        accountNo: row.accountNo || "",
        displayName: row.displayName || "",
        accountId: row.accountId || "",
        password: row.password || "",
        refNo1: row.refNo1 || "",
        defaultPartDist: row.defaultPartDist || "",
        sync: row.sync || "",
      }));
  } catch {
    return buildDefaultRows();
  }
}

function saveRows(rows: AccountRow[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ rows }));
}

export function AccountManagementPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [rows, setRows] = useState<AccountRow[]>(() => loadRows());
  const [savedRows, setSavedRows] = useState<AccountRow[]>(() => loadRows());
  const [showSavePrompt, setShowSavePrompt] = useState(false);

  const hasUnsavedChanges = useMemo(() => JSON.stringify(rows) !== JSON.stringify(savedRows), [rows, savedRows]);

  const addRow = () => {
    setRows((current) => [
      ...current,
      {
        id: `account-row-${Date.now()}`,
        type: "American Home Shield Account",
        accountNo: "",
        displayName: "",
        accountId: "",
        password: "",
        refNo1: "",
        defaultPartDist: "",
        sync: "",
      },
    ]);
  };

  const deleteRow = (rowId: string) => {
    setRows((current) => current.filter((row) => row.id !== rowId));
  };

  const saveChanges = () => {
    saveRows(rows);
    setSavedRows(rows);
    setShowSavePrompt(false);
  };

  const requestSave = () => {
    if (!hasUnsavedChanges) return;
    setShowSavePrompt(true);
  };

  return (
    <main className="flex-1 bg-slate-950 py-6">
      <div className="max-w-[1500px] mx-auto px-6">
        <Link
          to="/m/admin"
          className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-white/70 hover:text-white transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z"
              clipRule="evenodd"
            />
          </svg>
          Back to Admin
        </Link>
        <div className="rounded-xl border border-white/15 bg-white/8 p-5 text-white backdrop-blur-md">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{sub.title}</h1>
              <p className="mt-1 text-sm text-slate-300">{sub.description}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={addRow} className="btn">Add</button>
              <button type="button" onClick={requestSave} disabled={!hasUnsavedChanges} className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-50">Save Accounts</button>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto rounded-xl border border-white/15 bg-slate-950/60">
            <table className="min-w-[1280px] w-full text-sm">
              <thead>
                <tr className="bg-slate-900/90 text-blue-200">
                  <th className="px-4 py-3 text-left">Type*</th>
                  <th className="px-4 py-3 text-left">Account No*</th>
                  <th className="px-4 py-3 text-left">Display Name*</th>
                  <th className="px-4 py-3 text-left">ID*</th>
                  <th className="px-4 py-3 text-left">Password*</th>
                  <th className="px-4 py-3 text-left">Ref No 1</th>
                  <th className="px-4 py-3 text-left">Default Part Dist.</th>
                  <th className="px-4 py-3 text-left">Sync</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 text-slate-200">
                {rows.map((row, index) => (
                  <tr key={row.id} className={index % 2 === 0 ? "bg-white/[0.02]" : "bg-white/[0.04]"}>
                    <td className="px-4 py-3 align-middle">
                      <select
                        value={row.type}
                        onChange={(event) => setRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, type: event.target.value as AccountRow["type"] } : entry))}
                        title="Type"
                        aria-label="Type"
                        className="glass-input w-full min-w-[100px] text-sm"
                      >
                        {ACCOUNT_TYPE_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <input
                        value={row.accountNo}
                        onChange={(event) => setRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, accountNo: event.target.value } : entry))}
                        title="Account No"
                        placeholder="Account No"
                        className="glass-input w-full min-w-[160px] text-sm"
                      />
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <input
                        value={row.displayName}
                        onChange={(event) => setRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, displayName: event.target.value } : entry))}
                        title="Display Name"
                        placeholder="Display Name"
                        className="glass-input w-full min-w-[220px] text-sm"
                      />
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <input
                        value={row.accountId}
                        onChange={(event) => setRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, accountId: event.target.value } : entry))}
                        title="ID"
                        placeholder="ID"
                        className="glass-input w-full min-w-[140px] text-sm"
                      />
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <input
                        value={row.password}
                        onChange={(event) => setRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, password: event.target.value } : entry))}
                        title="Password"
                        placeholder="Password"
                        className="glass-input w-full min-w-[180px] text-sm"
                      />
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <input
                        value={row.refNo1}
                        onChange={(event) => setRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, refNo1: event.target.value } : entry))}
                        title="Ref No 1"
                        placeholder="Ref No 1"
                        className="glass-input w-full min-w-[160px] text-sm"
                      />
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <input
                        value={row.defaultPartDist}
                        onChange={(event) => setRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, defaultPartDist: event.target.value } : entry))}
                        title="Default Part Dist."
                        placeholder="Default Part Dist."
                        className="glass-input w-full min-w-[200px] text-sm"
                      />
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <input
                        value={row.sync}
                        onChange={(event) => setRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, sync: event.target.value } : entry))}
                        title="Sync"
                        placeholder="Sync"
                        className="glass-input w-full min-w-[120px] text-sm"
                      />
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <button type="button" onClick={() => deleteRow(row.id)} className="btn">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
              <button type="button" onClick={saveChanges} className="btn btn-primary">Save now</button>
              <button type="button" onClick={() => setShowSavePrompt(false)} className="btn">Keep editing</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}