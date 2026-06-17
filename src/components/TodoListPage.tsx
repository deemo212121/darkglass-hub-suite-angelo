import { useMemo, useState, useEffect } from "react";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, normalizeLocationName } from "@/lib/locations";
import { getCompanyTickets } from "@/lib/supabase/tickets";
import { useAuth } from "@/lib/auth";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

type TodoRow = Record<string, any> & { __id: string };

function normalizeBranch(branch: string) {
  return normalizeLocationName(String(branch || "")) || "Unassigned";
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
  const { ready: authReady } = useAuth();
  const [rows, setRows] = useState<TodoRow[]>([]);
  const [branch, setBranch] = useState("All Branches");
  const [branchOpen, setBranchOpen] = useState(false);

  // The To-Do list = follow-up tickets: status needs action (e.g. CSR-Assigned
  // to ASC and similar open statuses) OR tickets aging more than 1 day.
  useEffect(() => {
    let cancelled = false;
    const FOLLOWUP_STATUSES = new Set([
      "CSR-Assigned to ASC",
      "CSR-Acknowledged",
      "CSR-Left Message for Cx",
      "CSR-Needs Scheduling",
      "OP-Ready for Service",
      "OP-Reschedule Follow up",
      "OP-UPDATE HOLD",
      "OP-Waiting for Part",
      "TR-Need Triage",
      "TR-Need PO",
      "PT-Need PreAuthorization",
      "CL-Need",
      "CL-Parts Back Ordered",
    ]);
    const load = async () => {
      try {
        const tickets = await getCompanyTickets();
        const todo: TodoRow[] = tickets
          .filter((ticket) => {
            const aging = Number(ticket.aging ?? 0);
            return FOLLOWUP_STATUSES.has(ticket.status) || aging > 1;
          })
          .map((ticket) => ({
            __id: ticket.ticketNo,
            ticketNo: ticket.ticketNo,
            warranty: ticket.warranty,
            customer: ticket.customer,
            city: ticket.city,
            location: ticket.location,
            model: ticket.model,
            status: ticket.status,
            schedule: ticket.schedule,
            created: ticket.created,
            phone: ticket.phone,
            aging: ticket.aging,
          }));
        if (!cancelled) setRows(todo);
      } catch (err) {
        console.error("TodoList: failed to load tickets:", err);
        if (!cancelled) setRows([]);
      }
    };
    if (authReady) load();
    return () => { cancelled = true; };
  }, [authReady]);

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