import { useMemo, useState, useEffect } from "react";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, normalizeLocationName } from "@/lib/locations";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

type TodoRow = Record<string, any> & { __id: string };

function storageKey(mod: string, sub: string) {
  return `ahs:data:${mod}:${sub}`;
}

function normalizeBranch(branch: string) {
  return normalizeLocationName(String(branch || "")) || "Unassigned";
}

function seedRows(sub: SubModuleDef): TodoRow[] {
  const count = sub.count ?? 20;
  return Array.from({ length: count }, (_, index) => ({
    __id: `${sub.slug}-${index}`,
    ...sub.seed(index),
  }));
}

function formatDate(value: unknown) {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toISOString().slice(0, 10);
}

export function TodoListPage({ mod, sub }: Props) {
  const [rows, setRows] = useState<TodoRow[]>([]);
  const [branch, setBranch] = useState("All Branches");
  const [branchOpen, setBranchOpen] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(storageKey(mod.slug, sub.slug));
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as TodoRow[];
        setRows(parsed);
        return;
      } catch {
        // fall back to seeded rows
      }
    }
    setRows(seedRows(sub));
  }, [mod.slug, sub.slug, sub]);

  const branches = useMemo(() => {
    return ["All Branches", ...LOCATIONS];
  }, []);

  const filteredRows = useMemo(() => {
    if (branch === "All Branches") return rows;
    return rows.filter((row) => {
      const rowLocation = normalizeBranch(row.location ?? row.city ?? row.branch);
      return rowLocation === branch;
    });
  }, [rows, branch]);

  const visibleRows = filteredRows.map((row) => ({
    ticketNo: String(row.ticketNo ?? ""),
    warranty: String(row.warranty ?? ""),
    customer: String(row.customer ?? ""),
    model: String(row.model ?? ""),
    customerPref: String(row.customerPref ?? ""),
    status: String(row.status ?? ""),
    aging: String(row.aging ?? ""),
    created: formatDate(row.created),
  }));

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!event.target || !(event.target instanceof Node)) return;
      const menu = document.getElementById("todo-branch-menu");
      const button = document.getElementById("todo-branch-button");
      if (menu?.contains(event.target) || button?.contains(event.target)) return;
      setBranchOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <main className="max-w-[1400px] mx-auto px-6 py-6">
      <div className="flex items-center gap-3 mb-4">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn">
          <ChevronLeft className="h-4 w-4" /> Back to Tickets
        </Link>
        <div>
          <h1 className="text-2xl font-semibold leading-tight">TO-DO LIST</h1>
          <p className="text-sm text-muted-foreground">Follow-up tickets grouped by branch.</p>
        </div>
      </div>

      <div className="todo-panel">
        <div className="todo-meta">
          <div className="todo-meta-item">
            <span className="todo-meta-label">Branch</span>
            <div className="relative">
              <button
                id="todo-branch-button"
                type="button"
                onClick={() => setBranchOpen((current) => !current)}
                className="todo-branch-button"
              >
                <span>{branch}</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${branchOpen ? "rotate-180" : ""}`} />
              </button>
              {branchOpen && (
                <div id="todo-branch-menu" className="todo-branch-menu">
                  {branches.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        setBranch(option);
                        setBranchOpen(false);
                      }}
                      className={`todo-branch-option ${branch === option ? "is-active" : ""}`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="todo-meta-pill">In Progress</div>
          <div className="todo-meta-count">{visibleRows.length} record(s)</div>
        </div>

        <div className="table-wrap">
          <table className="todo-table">
            <thead>
              <tr>
                <th>Ticket Number</th>
                <th>Wty</th>
                <th>Cx Name</th>
                <th>Model</th>
                <th>Cx Prefer</th>
                <th>Status</th>
                <th>Aging</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="todo-empty">No open tickets found.</td>
                </tr>
              ) : (
                visibleRows.map((row) => (
                  <tr key={row.ticketNo}>
                    <td className="todo-ticket-no">
                      <Link
                        to="/ticket/$ticketNo"
                        params={{ ticketNo: row.ticketNo }}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="todo-ticket-link"
                      >
                        {row.ticketNo}
                      </Link>
                    </td>
                    <td>{row.warranty}</td>
                    <td className="todo-left">{row.customer}</td>
                    <td>{row.model}</td>
                    <td>{row.customerPref || "—"}</td>
                    <td>
                      <span className="status-pill">{row.status}</span>
                    </td>
                    <td>{row.aging}</td>
                    <td>{row.created}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}