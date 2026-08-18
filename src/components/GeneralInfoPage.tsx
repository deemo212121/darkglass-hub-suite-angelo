import { useEffect, useState } from "react";
import { ChevronLeft, Trash2, Loader2, Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { usePersistedTab } from "@/lib/usePersistedTab";
import { LOCATIONS } from "@/lib/locations";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import {
  getBranchRoles,
  upsertBranchRole,
  deleteBranchRole,
  getRegions,
  upsertRegion,
  deleteRegion,
  getLeadership,
  upsertLeadership,
  deleteLeadership,
  getAbbreviations,
  upsertAbbreviation,
  deleteAbbreviation,
  type BranchRoles,
  type Region,
  type LeadershipRole,
  type Abbreviation,
} from "@/lib/supabase/generalInfo";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

/**
 * Styled searchable combobox — same pattern as the "Search an employee…"
 * field elsewhere in the app (ReportHRDaily.tsx's COE/warning forms): a text
 * input that filters a custom dark dropdown list as you type, instead of the
 * browser's plain unstyled <datalist> popup. Still freely typeable — picking
 * a suggestion is optional, whatever's typed commits on blur either way.
 */
function NameAutocomplete({
  defaultValue,
  onCommit,
  options,
  placeholder,
  className,
}: {
  defaultValue: string;
  onCommit: (value: string) => void;
  options: string[];
  placeholder?: string;
  className: string;
}) {
  const [text, setText] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  useEffect(() => { setText(defaultValue); }, [defaultValue]);

  const query = text.trim().toLowerCase();
  const filtered = (query ? options.filter((o) => o.toLowerCase().includes(query)) : options).slice(0, 50);

  return (
    <div className="relative">
      <input
        type="text"
        value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setTimeout(() => setOpen(false), 150); onCommit(text); }}
        placeholder={placeholder}
        className={className}
      />
      {open && (
        <div className="absolute z-20 left-0 top-full mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-white/15 bg-slate-800 shadow-lg">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-400">No matches.</p>
          ) : (
            filtered.map((o) => (
              <button
                key={o}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setText(o); onCommit(o); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-white/10 text-slate-200"
              >
                {o}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const BRANCH_ROLE_COLUMNS: { key: keyof BranchRoles; label: string }[] = [
  { key: "seniorBranchManager", label: "Senior Branch Manager" },
  { key: "branchManager", label: "Branch Manager" },
  { key: "technicalManager", label: "Technical Manager" },
  { key: "bizops", label: "Bizops" },
  { key: "regionalTechnicalManager", label: "Regional Technical Manager" },
  { key: "partsManager", label: "Parts Manager" },
  { key: "assistantPartsManager", label: "Assistant Parts Manager" },
];

// Friendly section headers matching the source glossary's own titles —
// falls back to the raw category value for anything added later.
const ABBREVIATION_CATEGORY_LABELS: Record<string, string> = {
  General: "Abbreviations",
  "Branch/Area": "Branch/Areas Abbreviations",
};
function abbreviationCategoryLabel(category: string): string {
  return ABBREVIATION_CATEGORY_LABELS[category] ?? category;
}
const ABBREVIATION_CATEGORY_ORDER = ["General", "Branch/Area"];

const EMPTY_NEW_BRANCH_FORM = {
  branch: "",
  seniorBranchManager: "",
  branchManager: "",
  technicalManager: "",
  bizops: "",
  regionalTechnicalManager: "",
  partsManager: "",
  assistantPartsManager: "",
};

export function GeneralInfoPage({ mod, sub }: Props) {
  const { role } = useAuth();
  const canEdit = ["ADMIN", "HR", "SUPERADMIN"].includes(String(role || "").toUpperCase());

  const [activeTab, setActiveTab] = usePersistedTab<"branchRoles" | "regions" | "leadership" | "abbreviations">(
    "ahs:general-info-active-tab",
    ["branchRoles", "regions", "leadership", "abbreviations"],
    "branchRoles",
  );

  const [loading, setLoading] = useState(true);
  const [branchRoles, setBranchRoles] = useState<BranchRoles[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [leadership, setLeadership] = useState<LeadershipRole[]>([]);
  const [abbreviations, setAbbreviations] = useState<Abbreviation[]>([]);
  const [companyUsers, setCompanyUsers] = useState<ProfileRow[]>([]);

  const load = async () => {
    setLoading(true);
    const [br, rg, ld, ab, users] = await Promise.all([
      getBranchRoles(), getRegions(), getLeadership(), getAbbreviations(),
      getCompanyUsers().catch((err) => { console.error("Failed to load company users:", err); return [] as ProfileRow[]; }),
    ]);
    setBranchRoles(br);
    setRegions(rg);
    setLeadership(ld);
    setAbbreviations(ab);
    setCompanyUsers(users);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Every name field on this page suggests the same pool: every user in
  // this company's User Management, plus whatever's already typed anywhere
  // on the page (covers informal entries like "N/A" or a note that isn't a
  // real account) — an <input list="..."> still accepts free typing, this
  // just offers these as quick picks.
  const knownNames = Array.from(new Set([
    ...companyUsers.filter((u) => u.is_active).map((u) => u.display_name || u.email),
    ...branchRoles.flatMap((r) => BRANCH_ROLE_COLUMNS.map((col) => r[col.key] as string | null)),
    ...regions.map((r) => r.regionLead),
    ...leadership.map((r) => r.name),
  ].filter((n): n is string => !!n && n.trim() !== ""))).sort((a, b) => a.localeCompare(b));
  const regionNameOptions = Array.from(new Set(regions.map((r) => r.regionName))).sort((a, b) => a.localeCompare(b));
  const leadershipTitleOptions = Array.from(new Set(leadership.map((r) => r.title))).sort((a, b) => a.localeCompare(b));

  // ── Branch Roles filters ─────────────────────────────────────────────────
  const [branchFilter, setBranchFilter] = useState("");
  const [nameFilter, setNameFilter] = useState("");
  const filteredBranchRoles = branchRoles.filter((row) => {
    if (branchFilter && row.branch !== branchFilter) return false;
    const nameQuery = nameFilter.trim().toLowerCase();
    if (nameQuery) {
      const haystack = BRANCH_ROLE_COLUMNS.map((col) => (row[col.key] as string) || "").join(" ").toLowerCase();
      if (!haystack.includes(nameQuery)) return false;
    }
    return true;
  });

  // ── Leadership ───────────────────────────────────────────────────────────
  const [newLeadershipTitle, setNewLeadershipTitle] = useState("");
  const [newLeadershipName, setNewLeadershipName] = useState("");
  const [savingLeadership, setSavingLeadership] = useState(false);
  const [deletingLeadershipId, setDeletingLeadershipId] = useState<string | null>(null);

  const handleAddLeadership = async () => {
    if (!newLeadershipTitle.trim()) return;
    setSavingLeadership(true);
    try {
      await upsertLeadership({ title: newLeadershipTitle.trim(), name: newLeadershipName.trim(), sortOrder: leadership.length + 1 });
      setNewLeadershipTitle("");
      setNewLeadershipName("");
      setLeadership(await getLeadership());
    } catch (err) {
      alert(`Failed to save role: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingLeadership(false);
    }
  };

  const handleLeadershipFieldBlur = async (row: LeadershipRole, field: "title" | "name", value: string) => {
    if (value === (row[field] ?? "")) return;
    try {
      await upsertLeadership({ id: row.id, title: field === "title" ? value : row.title, name: field === "name" ? value : row.name || "" });
      setLeadership((prev) => prev.map((r) => (r.id === row.id ? { ...r, [field]: value } : r)));
    } catch (err) {
      alert(`Failed to save role: ${err instanceof Error ? err.message : "Unknown error"}`);
      load();
    }
  };

  const handleDeleteLeadership = async (row: LeadershipRole) => {
    if (!window.confirm(`Remove "${row.title}"?`)) return;
    setDeletingLeadershipId(row.id);
    try {
      await deleteLeadership(row.id);
      setLeadership((prev) => prev.filter((r) => r.id !== row.id));
    } catch (err) {
      alert(`Failed to remove role: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setDeletingLeadershipId(null);
    }
  };

  // ── Regions ──────────────────────────────────────────────────────────────
  const [newRegionName, setNewRegionName] = useState("");
  const [newRegionLead, setNewRegionLead] = useState("");
  const [newRegionBranches, setNewRegionBranches] = useState("");
  const [savingRegion, setSavingRegion] = useState(false);
  const [deletingRegionId, setDeletingRegionId] = useState<string | null>(null);

  const handleAddRegion = async () => {
    if (!newRegionName.trim()) return;
    setSavingRegion(true);
    try {
      await upsertRegion({
        regionName: newRegionName.trim(),
        regionLead: newRegionLead.trim(),
        branches: newRegionBranches.split(",").map((b) => b.trim()).filter(Boolean),
        sortOrder: regions.length + 1,
      });
      setNewRegionName("");
      setNewRegionLead("");
      setNewRegionBranches("");
      setRegions(await getRegions());
    } catch (err) {
      alert(`Failed to save region: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingRegion(false);
    }
  };

  const handleRegionFieldBlur = async (row: Region, field: "regionName" | "regionLead" | "branches", value: string) => {
    const nextBranches = field === "branches" ? value.split(",").map((b) => b.trim()).filter(Boolean) : row.branches;
    try {
      await upsertRegion({
        id: row.id,
        regionName: field === "regionName" ? value : row.regionName,
        regionLead: field === "regionLead" ? value : row.regionLead || "",
        branches: nextBranches,
      });
      setRegions((prev) => prev.map((r) => (r.id === row.id
        ? { ...r, regionName: field === "regionName" ? value : r.regionName, regionLead: field === "regionLead" ? value : r.regionLead, branches: nextBranches }
        : r)));
    } catch (err) {
      alert(`Failed to save region: ${err instanceof Error ? err.message : "Unknown error"}`);
      load();
    }
  };

  const handleDeleteRegion = async (row: Region) => {
    if (!window.confirm(`Remove "${row.regionName}"?`)) return;
    setDeletingRegionId(row.id);
    try {
      await deleteRegion(row.id);
      setRegions((prev) => prev.filter((r) => r.id !== row.id));
    } catch (err) {
      alert(`Failed to remove region: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setDeletingRegionId(null);
    }
  };

  // ── Branch Roles ─────────────────────────────────────────────────────────
  const [newBranchForm, setNewBranchForm] = useState(EMPTY_NEW_BRANCH_FORM);
  const [savingBranchRole, setSavingBranchRole] = useState(false);
  const [deletingBranchRoleId, setDeletingBranchRoleId] = useState<string | null>(null);
  const usedBranches = new Set(branchRoles.map((r) => r.branch));
  const availableBranches = LOCATIONS.filter((b) => !usedBranches.has(b));

  const handleAddBranchRole = async () => {
    if (!newBranchForm.branch) return;
    setSavingBranchRole(true);
    try {
      await upsertBranchRole({ ...newBranchForm, sortOrder: branchRoles.length + 1 });
      setNewBranchForm(EMPTY_NEW_BRANCH_FORM);
      setBranchRoles(await getBranchRoles());
    } catch (err) {
      alert(`Failed to save branch: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingBranchRole(false);
    }
  };

  const handleBranchFieldBlur = async (row: BranchRoles, field: keyof BranchRoles, value: string) => {
    if (value === (row[field] ?? "")) return;
    try {
      await upsertBranchRole({
        id: row.id,
        branch: row.branch,
        seniorBranchManager: row.seniorBranchManager || "",
        branchManager: row.branchManager || "",
        technicalManager: row.technicalManager || "",
        bizops: row.bizops || "",
        regionalTechnicalManager: row.regionalTechnicalManager || "",
        partsManager: row.partsManager || "",
        assistantPartsManager: row.assistantPartsManager || "",
        [field]: value,
      });
      setBranchRoles((prev) => prev.map((r) => (r.id === row.id ? { ...r, [field]: value } : r)));
    } catch (err) {
      alert(`Failed to save branch: ${err instanceof Error ? err.message : "Unknown error"}`);
      load();
    }
  };

  const handleDeleteBranchRole = async (row: BranchRoles) => {
    if (!window.confirm(`Remove "${row.branch}" from the directory?`)) return;
    setDeletingBranchRoleId(row.id);
    try {
      await deleteBranchRole(row.id);
      setBranchRoles((prev) => prev.filter((r) => r.id !== row.id));
    } catch (err) {
      alert(`Failed to remove branch: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setDeletingBranchRoleId(null);
    }
  };

  // ── Abbreviations ────────────────────────────────────────────────────────
  const [newAbbrCategory, setNewAbbrCategory] = useState("General");
  const [newAbbrCode, setNewAbbrCode] = useState("");
  const [newAbbrMeaning, setNewAbbrMeaning] = useState("");
  const [savingAbbr, setSavingAbbr] = useState(false);
  const [deletingAbbrId, setDeletingAbbrId] = useState<string | null>(null);
  const abbreviationCategories = Array.from(new Set(abbreviations.map((a) => a.category)));
  const groupedAbbreviations = (() => {
    const byCategory = new Map<string, Abbreviation[]>();
    for (const a of abbreviations) {
      const list = byCategory.get(a.category) ?? [];
      list.push(a);
      byCategory.set(a.category, list);
    }
    return Array.from(byCategory.entries())
      .sort((a, b) => {
        const ai = ABBREVIATION_CATEGORY_ORDER.indexOf(a[0]);
        const bi = ABBREVIATION_CATEGORY_ORDER.indexOf(b[0]);
        if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        return a[0].localeCompare(b[0]);
      })
      .map(([category, rows]) => ({ category, rows: [...rows].sort((a, b) => a.sortOrder - b.sortOrder) }));
  })();

  const handleAddAbbreviation = async () => {
    if (!newAbbrCategory.trim() || !newAbbrCode.trim()) return;
    setSavingAbbr(true);
    try {
      await upsertAbbreviation({
        category: newAbbrCategory.trim(),
        abbreviation: newAbbrCode.trim(),
        meaning: newAbbrMeaning.trim(),
        sortOrder: abbreviations.length + 1,
      });
      setNewAbbrCode("");
      setNewAbbrMeaning("");
      setAbbreviations(await getAbbreviations());
    } catch (err) {
      alert(`Failed to save abbreviation: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingAbbr(false);
    }
  };

  const handleAbbreviationFieldBlur = async (row: Abbreviation, field: "category" | "abbreviation" | "meaning", value: string) => {
    if (value === (row[field] ?? "")) return;
    try {
      await upsertAbbreviation({
        id: row.id,
        category: field === "category" ? value : row.category,
        abbreviation: field === "abbreviation" ? value : row.abbreviation,
        meaning: field === "meaning" ? value : row.meaning || "",
      });
      setAbbreviations((prev) => prev.map((r) => (r.id === row.id ? { ...r, [field]: value } : r)));
    } catch (err) {
      alert(`Failed to save abbreviation: ${err instanceof Error ? err.message : "Unknown error"}`);
      load();
    }
  };

  const handleDeleteAbbreviation = async (row: Abbreviation) => {
    if (!window.confirm(`Remove "${row.abbreviation}"?`)) return;
    setDeletingAbbrId(row.id);
    try {
      await deleteAbbreviation(row.id);
      setAbbreviations((prev) => prev.filter((r) => r.id !== row.id));
    } catch (err) {
      alert(`Failed to remove abbreviation: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setDeletingAbbrId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Loading general information…</span>
        </div>
      </div>
    );
  }

  return (
    <main className="max-w-[1600px] mx-auto px-6 py-8">
      <div className="sticky top-[64px] z-10 -mx-6 px-6 pb-2 backdrop-blur-md bg-[var(--color-background)]/95">
        <div className="flex items-center gap-3 mb-6 pt-2">
          <Link to="/m/$module" params={{ module: mod.slug }} className="btn"><ChevronLeft className="h-4 w-4" /></Link>
          <div>
            <h1 className="text-xl font-bold text-white">General Information</h1>
            <p className="text-sm text-slate-400">Branch management directory — roles, regions, leadership, and abbreviations.</p>
          </div>
        </div>

        <div className="flex gap-2 border-b border-white/10 overflow-x-auto">
          {([
            { id: "branchRoles", label: "Branch Roles" },
            { id: "regions", label: "Regions" },
            { id: "leadership", label: "Leadership" },
            { id: "abbreviations", label: "Abbreviations" },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 border-b-2 transition whitespace-nowrap ${
                activeTab === tab.id
                  ? "border-blue-500 text-blue-300"
                  : "border-transparent text-slate-400 hover:text-slate-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-8 mt-6">
        {/* ── Leadership ──────────────────────────────────────────────── */}
        {activeTab === "leadership" && (
        <div className="bg-slate-900/50 border border-white/10 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10">
            <h2 className="text-sm font-semibold text-white">Leadership</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-700/80">
                  <th className="px-3 py-3 text-xs font-semibold text-slate-200 text-left">Title</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-200 text-left">Name</th>
                  {canEdit && <th className="px-3 py-3 text-xs font-semibold text-slate-200 text-left">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {leadership.map((row) => (
                  <tr key={row.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2 text-slate-300">
                      {canEdit ? (
                        <NameAutocomplete
                          defaultValue={row.title}
                          onCommit={(v) => handleLeadershipFieldBlur(row, "title", v)}
                          options={leadershipTitleOptions}
                          className="glass-input text-sm px-2 py-1 w-full"
                        />
                      ) : row.title}
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {canEdit ? (
                        <NameAutocomplete
                          defaultValue={row.name ?? ""}
                          onCommit={(v) => handleLeadershipFieldBlur(row, "name", v)}
                          options={knownNames}
                          className="glass-input text-sm px-2 py-1 w-full"
                        />
                      ) : (row.name || "—")}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-2">
                        <button onClick={() => handleDeleteLeadership(row)} disabled={deletingLeadershipId === row.id} className="text-red-400 hover:text-red-300 disabled:opacity-40">
                          {deletingLeadershipId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {canEdit && (
                  <tr className="border-b border-white/5">
                    <td className="px-3 py-2">
                      <NameAutocomplete
                        defaultValue={newLeadershipTitle}
                        onCommit={setNewLeadershipTitle}
                        options={leadershipTitleOptions}
                        placeholder="Title"
                        className="glass-input text-sm px-2 py-1 w-full border-dashed"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <NameAutocomplete
                        defaultValue={newLeadershipName}
                        onCommit={setNewLeadershipName}
                        options={knownNames}
                        placeholder="Name"
                        className="glass-input text-sm px-2 py-1 w-full border-dashed"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={handleAddLeadership} disabled={savingLeadership || !newLeadershipTitle.trim()} className="text-blue-400 text-xs font-medium hover:text-blue-300 disabled:opacity-40 flex items-center gap-1">
                        {savingLeadership ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {/* ── Regions ─────────────────────────────────────────────────── */}
        {activeTab === "regions" && (
        <div className="bg-slate-900/50 border border-white/10 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10">
            <h2 className="text-sm font-semibold text-white">Regions</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-700/80">
                  <th className="px-3 py-3 text-xs font-semibold text-slate-200 text-left">Region</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-200 text-left">Region Lead</th>
                  <th className="px-3 py-3 text-xs font-semibold text-slate-200 text-left">Branches</th>
                  {canEdit && <th className="px-3 py-3 text-xs font-semibold text-slate-200 text-left">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {regions.map((row) => (
                  <tr key={row.id} className="border-b border-white/5 hover:bg-white/5 align-top">
                    <td className="px-3 py-2 text-slate-300">
                      {canEdit ? (
                        <NameAutocomplete
                          defaultValue={row.regionName}
                          onCommit={(v) => handleRegionFieldBlur(row, "regionName", v)}
                          options={regionNameOptions}
                          className="glass-input text-sm px-2 py-1 w-full"
                        />
                      ) : row.regionName}
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {canEdit ? (
                        <NameAutocomplete
                          defaultValue={row.regionLead ?? ""}
                          onCommit={(v) => handleRegionFieldBlur(row, "regionLead", v)}
                          options={knownNames}
                          className="glass-input text-sm px-2 py-1 w-full"
                        />
                      ) : (row.regionLead || "—")}
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {canEdit ? (
                        <input
                          defaultValue={row.branches.join(", ")}
                          onBlur={(e) => handleRegionFieldBlur(row, "branches", e.target.value)}
                          placeholder="Comma-separated branch names"
                          className="glass-input text-sm px-2 py-1 w-full min-w-64"
                        />
                      ) : row.branches.join(", ")}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-2">
                        <button onClick={() => handleDeleteRegion(row)} disabled={deletingRegionId === row.id} className="text-red-400 hover:text-red-300 disabled:opacity-40">
                          {deletingRegionId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {canEdit && (
                  <tr className="border-b border-white/5">
                    <td className="px-3 py-2">
                      <NameAutocomplete
                        defaultValue={newRegionName}
                        onCommit={setNewRegionName}
                        options={regionNameOptions}
                        placeholder="Region name"
                        className="glass-input text-sm px-2 py-1 w-full border-dashed"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <NameAutocomplete
                        defaultValue={newRegionLead}
                        onCommit={setNewRegionLead}
                        options={knownNames}
                        placeholder="Region lead"
                        className="glass-input text-sm px-2 py-1 w-full border-dashed"
                      />
                    </td>
                    <td className="px-3 py-2"><input value={newRegionBranches} onChange={(e) => setNewRegionBranches(e.target.value)} placeholder="Comma-separated branch names" className="glass-input text-sm px-2 py-1 w-full min-w-64 border-dashed" /></td>
                    <td className="px-3 py-2">
                      <button onClick={handleAddRegion} disabled={savingRegion || !newRegionName.trim()} className="text-blue-400 text-xs font-medium hover:text-blue-300 disabled:opacity-40 flex items-center gap-1">
                        {savingRegion ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {/* ── Branch Roles ────────────────────────────────────────────── */}
        {activeTab === "branchRoles" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1.5 text-sm text-slate-200">
              <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Branch</span>
              <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="glass-input text-sm px-2 py-1.5 w-56">
                <option value="">All Branches</option>
                {branchRoles.map((r) => (
                  <option key={r.branch} value={r.branch}>{r.branch}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-sm text-slate-200">
              <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Name</span>
              <input
                type="text"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
                placeholder="Search any role name…"
                className="glass-input text-sm px-2 py-1.5 w-56"
              />
            </label>
            {(branchFilter || nameFilter) && (
              <button onClick={() => { setBranchFilter(""); setNameFilter(""); }} className="text-xs text-blue-400 hover:text-blue-300 mb-1.5">
                Clear filters
              </button>
            )}
          </div>
        <div className="bg-slate-900/50 border border-white/10 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10">
            <h2 className="text-sm font-semibold text-white">Branch Roles</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-700/80">
                  <th className="px-3 py-3 text-xs font-semibold text-slate-200 text-left">Branch</th>
                  {BRANCH_ROLE_COLUMNS.map((col) => (
                    <th key={col.key} className="px-3 py-3 text-xs font-semibold text-slate-200 text-left whitespace-nowrap">{col.label}</th>
                  ))}
                  {canEdit && <th className="px-3 py-3 text-xs font-semibold text-slate-200 text-left">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredBranchRoles.map((row) => (
                  <tr key={row.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2.5 text-slate-300 font-medium whitespace-nowrap">{row.branch}</td>
                    {BRANCH_ROLE_COLUMNS.map((col) => (
                      <td key={col.key} className="px-3 py-2">
                        {canEdit ? (
                          <NameAutocomplete
                            defaultValue={(row[col.key] as string) ?? ""}
                            onCommit={(v) => handleBranchFieldBlur(row, col.key, v)}
                            options={knownNames}
                            className="glass-input text-sm px-2 py-1 w-40"
                          />
                        ) : ((row[col.key] as string) || "—")}
                      </td>
                    ))}
                    {canEdit && (
                      <td className="px-3 py-2.5">
                        <button onClick={() => handleDeleteBranchRole(row)} disabled={deletingBranchRoleId === row.id} className="text-red-400 hover:text-red-300 disabled:opacity-40">
                          {deletingBranchRoleId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {canEdit && (
                  <tr className="border-b border-white/5">
                    <td className="px-3 py-2">
                      <select value={newBranchForm.branch} onChange={(e) => setNewBranchForm((f) => ({ ...f, branch: e.target.value }))} className="glass-input text-sm px-2 py-1 w-36 border-dashed">
                        <option value="">Select branch…</option>
                        {availableBranches.map((b) => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </td>
                    {BRANCH_ROLE_COLUMNS.map((col) => (
                      <td key={col.key} className="px-3 py-2">
                        <NameAutocomplete
                          defaultValue={newBranchForm[col.key as keyof typeof newBranchForm]}
                          onCommit={(v) => setNewBranchForm((f) => ({ ...f, [col.key]: v }))}
                          options={knownNames}
                          className="glass-input text-sm px-2 py-1 w-40 border-dashed"
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2.5">
                      <button onClick={handleAddBranchRole} disabled={savingBranchRole || !newBranchForm.branch} className="text-blue-400 text-xs font-medium hover:text-blue-300 disabled:opacity-40 flex items-center gap-1">
                        {savingBranchRole ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        </div>
        )}

        {/* ── Abbreviations ───────────────────────────────────────────── */}
        {activeTab === "abbreviations" && (
        <div className="space-y-6">
          {groupedAbbreviations.map(({ category, rows }) => (
            <div key={category} className="bg-slate-900/50 border border-white/10 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10">
                <h2 className="text-sm font-semibold text-white">{abbreviationCategoryLabel(category)}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-700/80">
                      <th className="px-3 py-3 text-xs font-semibold text-slate-200 text-left w-32">Abbreviation</th>
                      <th className="px-3 py-3 text-xs font-semibold text-slate-200 text-left">Meaning</th>
                      {canEdit && <th className="px-3 py-3 text-xs font-semibold text-slate-200 text-left w-20">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-b border-white/5 hover:bg-white/5">
                        <td className="px-3 py-2 text-slate-300 font-medium">
                          {canEdit ? (
                            <input defaultValue={row.abbreviation} onBlur={(e) => handleAbbreviationFieldBlur(row, "abbreviation", e.target.value)} className="glass-input text-sm px-2 py-1 w-28" />
                          ) : row.abbreviation}
                        </td>
                        <td className="px-3 py-2 text-slate-300">
                          {canEdit ? (
                            <input defaultValue={row.meaning ?? ""} onBlur={(e) => handleAbbreviationFieldBlur(row, "meaning", e.target.value)} className="glass-input text-sm px-2 py-1 w-full" />
                          ) : (row.meaning || "—")}
                        </td>
                        {canEdit && (
                          <td className="px-3 py-2">
                            <button onClick={() => handleDeleteAbbreviation(row)} disabled={deletingAbbrId === row.id} className="text-red-400 hover:text-red-300 disabled:opacity-40">
                              {deletingAbbrId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {canEdit && (
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <p className="text-xs uppercase tracking-[0.08em] text-slate-400 mb-3">Add Abbreviation</p>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                <label className="space-y-1.5 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Category</span>
                  <NameAutocomplete
                    defaultValue={newAbbrCategory}
                    onCommit={setNewAbbrCategory}
                    options={abbreviationCategories}
                    placeholder="Category"
                    className="glass-input text-sm px-2 py-1.5 w-full"
                  />
                </label>
                <label className="space-y-1.5 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Abbreviation</span>
                  <input value={newAbbrCode} onChange={(e) => setNewAbbrCode(e.target.value)} placeholder="Abbreviation" className="glass-input text-sm px-2 py-1.5 w-full" />
                </label>
                <label className="space-y-1.5 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Meaning</span>
                  <input value={newAbbrMeaning} onChange={(e) => setNewAbbrMeaning(e.target.value)} placeholder="Meaning" className="glass-input text-sm px-2 py-1.5 w-full" />
                </label>
                <button onClick={handleAddAbbreviation} disabled={savingAbbr || !newAbbrCategory.trim() || !newAbbrCode.trim()} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg text-sm font-semibold transition flex items-center justify-center gap-2">
                  {savingAbbr ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
                </button>
              </div>
            </div>
          )}
        </div>
        )}
      </div>
    </main>
  );
}
