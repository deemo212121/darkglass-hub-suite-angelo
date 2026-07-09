import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { SubModuleDef, ModuleDef } from "@/lib/modules";
import { ChevronLeft, Plus, RefreshCw, Save, Trash2 } from "lucide-react";

type Row = Record<string, any> & { __id: string };

function storageKey(mod: string, sub: string) {
  return `ahs:data:${mod}:${sub}`;
}
function filterKey(mod: string, sub: string) {
  return `ahs:filters:${mod}:${sub}`;
}

export function GenericModulePage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const count = sub.count ?? 20;
  const [rows, setRows] = useState<Row[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");

  // Hydrate from localStorage (client-only)
  useEffect(() => {
    const raw = localStorage.getItem(storageKey(mod.slug, sub.slug));
    if (raw) {
      try { setRows(JSON.parse(raw)); return; } catch {}
    }
    const seeded: Row[] = Array.from({ length: count }, (_, i) => ({
      __id: `${sub.slug}-${i}`,
      ...sub.seed(i),
    }));
    setRows(seeded);
    const f = localStorage.getItem(filterKey(mod.slug, sub.slug));
    if (f) { try { setFilters(JSON.parse(f)); } catch {} }
  }, [mod.slug, sub.slug, count]);

  const persist = (next: Row[]) => {
    setRows(next);
    localStorage.setItem(storageKey(mod.slug, sub.slug), JSON.stringify(next));
  };

  const filterableFields = sub.fields.filter((f) => f.filterable);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      for (const k of Object.keys(filters)) {
        const v = filters[k];
        if (!v) continue;
        if (String(r[k] ?? "").toLowerCase() !== v.toLowerCase()) {
          // for text filterable use contains
          if (!String(r[k] ?? "").toLowerCase().includes(v.toLowerCase())) return false;
        }
      }
      if (search) {
        const hay = Object.values(r).map(String).join(" ").toLowerCase();
        if (!hay.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [rows, filters, search]);

  const updateRow = (id: string, key: string, value: any) => {
    persist(rows.map((r) => (r.__id === id ? { ...r, [key]: value } : r)));
  };
  const deleteRow = (id: string) => persist(rows.filter((r) => r.__id !== id));
  const addRow = () => {
    const blank: Row = { __id: `${sub.slug}-new-${Date.now()}` };
    for (const f of sub.fields) blank[f.key] = f.type === "number" ? 0 : "";
    persist([blank, ...rows]);
  };
  const resetFilters = () => {
    setFilters({});
    setSearch("");
    localStorage.removeItem(filterKey(mod.slug, sub.slug));
  };
  const saveFilters = () => {
    localStorage.setItem(filterKey(mod.slug, sub.slug), JSON.stringify(filters));
  };

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-6">
      <div className="flex items-center gap-3 mb-4">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn">
          <ChevronLeft className="h-4 w-4" /> {mod.label}
        </Link>
        <div>
          <h1 className="text-2xl font-semibold leading-tight">{sub.title}</h1>
          <p className="text-sm text-muted-foreground">{sub.description}</p>
        </div>
      </div>

      <div className="panel">
        <div className="filter-grid">
          <input
            className="glass-input"
            placeholder="Search all fields…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {filterableFields.map((f) => (
            <div key={f.key}>
              {f.type === "select" ? (
                <select
                  className="glass-input"
                  title={`Filter by ${f.label}`}
                  value={filters[f.key] ?? ""}
                  onChange={(e) => setFilters({ ...filters, [f.key]: e.target.value })}
                >
                  <option value="">All {f.label}</option>
                  {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  className="glass-input"
                  placeholder={f.label}
                  value={filters[f.key] ?? ""}
                  onChange={(e) => setFilters({ ...filters, [f.key]: e.target.value })}
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-4">
          <button className="btn" onClick={resetFilters} title="Clear all filters">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button className="btn" onClick={saveFilters} title="Save current filters">
            <Save className="h-4 w-4" />
            Save
          </button>
          <button className="btn btn-primary" onClick={addRow}>
            <Plus className="h-4 w-4" />
            Add {sub.title}
          </button>
          <div className="ml-auto text-xs text-muted-foreground">
            {filtered.length} of {rows.length} records
          </div>
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              {sub.fields.map((f) => <th key={f.key}>{f.label}</th>)}
              <th className="w-[60px]"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.__id}>
                {sub.fields.map((f) => (
                  <td key={f.key}>
                    {f.editable ? (
                      f.type === "select" ? (
                        <select
                          value={r[f.key] ?? ""}
                          title={`Edit ${f.label}`}
                          onChange={(e) => updateRow(r.__id, f.key, e.target.value)}
                          className="editable-cell"
                        >
                          <option value="">—</option>
                          {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input
                          type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                          placeholder={`Edit ${f.label}`}
                          value={r[f.key] ?? ""}
                          onChange={(e) => updateRow(r.__id, f.key, f.type === "number" ? Number(e.target.value) : e.target.value)}
                          className="editable-cell"
                        />
                      )
                    ) : (
                      <span className="text-foreground/90">{String(r[f.key] ?? "")}</span>
                    )}
                  </td>
                ))}
                <td className="text-center">
                  <button
                    className="text-destructive hover:opacity-80 p-1 rounded transition-colors"
                    onClick={() => deleteRow(r.__id)}
                    aria-label="Delete row"
                    title="Delete this record"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={sub.fields.length + 1} className="text-center py-12 text-muted-foreground">
                  <p className="text-sm">No records</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
