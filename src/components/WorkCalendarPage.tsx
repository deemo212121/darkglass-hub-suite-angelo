import { useMemo, useState, useEffect } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Home, ListFilter, Search } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { getCompanyTickets } from "@/lib/supabase/tickets";
import type { Ticket } from "@/lib/ticketData";
import { normalizeTimePeriod, FRAME_START_TIME } from "@/lib/timeframes";
import { ALL_TECHNICIANS } from "@/lib/locations";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

type CalendarRow = {
  technician: string;
  ticketNo: string;
  customer: string;
  type: string;
  postingDate: string;
  schedule: string;
  slot: "AM" | "PM";
  scheduleTime: string;
  status: string;
  modelCode: string;
  serial: string;
  address: string;
  aging: number;
  repairType: string;
};

const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function buildCalendarWeeks(monthValue: string) {
  const base = monthValue ? new Date(`${monthValue}-01T00:00:00`) : new Date();
  const year = base.getFullYear();
  const month = base.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const start = new Date(firstOfMonth);
  start.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());
  const lastOfMonth = new Date(year, month + 1, 0);
  const end = new Date(lastOfMonth);
  end.setDate(lastOfMonth.getDate() + (6 - lastOfMonth.getDay()));

  const weeks: Array<Array<{ date: Date; currentMonth: boolean; key: string }>> = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    const week = Array.from({ length: 7 }, (_, dayOffset) => {
      const date = new Date(cursor);
      date.setDate(cursor.getDate() + dayOffset);
      return {
        date,
        currentMonth: date.getMonth() === month,
        key: date.toISOString().slice(0, 10),
      };
    });
    weeks.push(week);
    cursor.setDate(cursor.getDate() + 7);
  }

  return weeks;
}

function monthLabel(monthValue: string) {
  if (!monthValue) return "";
  const date = new Date(`${monthValue}-01T00:00:00`);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// monthValue is always "YYYY-MM" (day-of-month is never part of the state),
// and shifting always starts from the 1st, so this can never roll over into
// the wrong month the way `date.setMonth()` can on e.g. Jan 31 + 1 month.
function shiftMonth(monthValue: string, offset: number) {
  if (!monthValue) return monthValue;
  const date = new Date(`${monthValue}-01T00:00:00`);
  date.setMonth(date.getMonth() + offset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function formatDate(date: Date) {
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}`;
}

/** `ticket.schedule` is a Postgres `YYYY-MM-DD` string (tickets.schedule_date) — parse as local, not UTC, so it lands on the right calendar cell regardless of timezone. */
function parseScheduleDate(schedule: string): Date | null {
  if (!schedule) return null;
  const [year, month, day] = schedule.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

/** A ticket's time_slot is a Work Planner frame ("8-12", "1-5", "ANYTIME", or a raw ServicePower window) — bucket it into this calendar's two rows using the frame's representative start time. */
function slotFor(schedulePeriod: string | undefined): { slot: "AM" | "PM"; label: string } {
  const frame = normalizeTimePeriod(schedulePeriod) ?? "ANYTIME";
  const start = FRAME_START_TIME[frame] ?? FRAME_START_TIME.ANYTIME;
  const hour = Number(start.slice(0, 2));
  return { slot: hour < 12 ? "AM" : "PM", label: frame };
}

function buildRowsFromTickets(tickets: Ticket[]): CalendarRow[] {
  return tickets
    .filter((t) => !!t.schedule)
    .map((t) => {
      const scheduleDate = parseScheduleDate(t.schedule);
      const { slot, label } = slotFor(t.schedulePeriod);
      const addressParts = [t.address, t.city, t.zip].filter(Boolean);
      return {
        technician: t.technician || "Unassigned",
        ticketNo: t.ticketNo,
        customer: t.customer || "",
        type: t.type || "",
        postingDate: t.created ? formatDate(new Date(`${t.created}T00:00:00`)) : "",
        schedule: scheduleDate ? formatDate(scheduleDate) : "",
        slot,
        scheduleTime: label,
        status: t.status || "",
        modelCode: t.model || "",
        serial: t.serial || "",
        address: addressParts.join(", "),
        aging: t.aging || 0,
        repairType: t.warranty || "",
      };
    })
    .filter((row) => !!row.schedule);
}

export function WorkCalendarPage({ mod, sub }: Props) {
  const now = new Date();
  const [technician, setTechnician] = useState("");
  const [monthValue, setMonthValue] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [monthDraft, setMonthDraft] = useState(monthValue);
  const [showTicketNo, setShowTicketNo] = useState(true);
  const [showAddress, setShowAddress] = useState(true);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [search, setSearch] = useState("");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setLoadError(null);
        const rows = await getCompanyTickets();
        if (!alive) return;
        setTickets(rows);
      } catch (err) {
        if (!alive) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && event.key === "ArrowLeft") {
        setMonthValue((current) => shiftMonth(current, -1));
      }
      if (event.altKey && event.key === "ArrowRight") {
        setMonthValue((current) => shiftMonth(current, 1));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Keep the free-text month field in sync when monthValue changes via the
  // prev/next buttons or Alt+Arrow shortcuts (not just from direct typing).
  useEffect(() => {
    setMonthDraft(monthValue);
  }, [monthValue]);

  const allRows = useMemo(() => buildRowsFromTickets(tickets), [tickets]);

  // Full company technician roster (src/lib/locations.ts), not just techs
  // with a scheduled ticket in view — otherwise the dropdown would shrink
  // to whoever happens to have work booked this month.
  const technicianOptions = useMemo(() => {
    const fromTickets = allRows.map((r) => r.technician).filter((name) => name && name !== "Unassigned");
    return Array.from(new Set([...ALL_TECHNICIANS, ...fromTickets])).sort((a, b) => a.localeCompare(b));
  }, [allRows]);

  const monthRows = useMemo(() => {
    return allRows.filter((row) => {
      const [mm, , yyyy] = row.schedule.split("/");
      if (!mm || !yyyy) return false;
      return `${yyyy}-${mm}` === monthValue;
    });
  }, [allRows, monthValue]);

  const calendarWeeks = useMemo(() => buildCalendarWeeks(monthValue), [monthValue]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return monthRows.filter((row) => {
      if (technician && row.technician !== technician) return false;
      if (!query) return true;
      const haystack = [
        row.ticketNo,
        row.type,
        row.postingDate,
        row.schedule,
        row.status,
        row.modelCode,
        row.serial,
        row.address,
        String(row.aging),
        row.repairType,
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [monthRows, technician, search]);

  const rowsByDateAndSlot = useMemo(() => {
    return filteredRows.reduce<Record<string, CalendarRow[]>>((accumulator, row) => {
      const key = `${row.schedule}|${row.slot}`;
      (accumulator[key] ??= []).push(row);
      return accumulator;
    }, {});
  }, [filteredRows]);

  const monthDisplay = monthLabel(monthValue);

  return (
    <main className="max-w-[1400px] mx-auto px-6 py-6">
      <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
        <Link to="/home" className="hover:text-foreground inline-flex items-center gap-1.5">
          <Home className="h-3.5 w-3.5" />
        </Link>
        <span>›</span>
        <Link to="/m/$module" params={{ module: mod.slug }} className="hover:text-foreground">
          Tickets
        </Link>
        <span>›</span>
        <span className="text-foreground font-medium">Work Calendar (Monthly)</span>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn">
          <ChevronLeft className="h-4 w-4" />
          Back to Tickets
        </Link>
        <div>
          <h1 className="text-2xl font-semibold leading-tight">Work Calendar (Monthly)</h1>
          <p className="text-sm text-muted-foreground">Scheduled jobs by date.</p>
        </div>
      </div>

      <div className="calendar-panel mb-5">
        <div className="control-grid">
          <div className="control-group">
            <label htmlFor="technician">Technician</label>
            <select
              id="technician"
              value={technician}
              onChange={(event) => setTechnician(event.target.value)}
              className="glass-input"
            >
              <option value="">All Technicians</option>
              {technicianOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>

          <div className="control-group">
            <label htmlFor="monthPicker">Month</label>
            <div className="month-nav">
              <button
                type="button"
                className="month-arrow"
                aria-label="Previous month"
                onClick={() => setMonthValue((current) => shiftMonth(current, -1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <input
                id="monthPicker"
                type="text"
                inputMode="numeric"
                pattern="\d{4}-\d{2}"
                placeholder="YYYY-MM"
                value={monthDraft}
                onChange={(event) => {
                  const next = event.target.value;
                  setMonthDraft(next);
                  if (/^\d{4}-\d{2}$/.test(next)) setMonthValue(next);
                }}
                onBlur={(event) => {
                  if (!/^\d{4}-\d{2}$/.test(event.target.value)) setMonthDraft(monthValue);
                }}
                className="glass-input"
              />
              <button
                type="button"
                className="month-arrow"
                aria-label="Next month"
                onClick={() => setMonthValue((current) => shiftMonth(current, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div id="monthBanner" className="month-banner">{monthDisplay}</div>

        <div className="option-row">
          <div className="show-group">
            <span>Show</span>
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={showTicketNo} onChange={(event) => setShowTicketNo(event.target.checked)} />
              Ticket No
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={showAddress} onChange={(event) => setShowAddress(event.target.checked)} />
              Name/City/Zip
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`toggle-btn ${view === "calendar" ? "active" : ""}`}
              onClick={() => setView("calendar")}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              Calendar View
            </button>
            <button
              type="button"
              className={`toggle-btn ${view === "list" ? "active" : ""}`}
              onClick={() => setView("list")}
            >
              <ListFilter className="h-3.5 w-3.5" />
              List View
            </button>
          </div>
        </div>

        <div className="meta-row">
          <div id="recordCount" className="count-text">
            {loading ? "Loading…" : `${filteredRows.length} records found`}
          </div>
          <div className="relative min-w-[220px] flex-1 sm:flex-none sm:min-w-[260px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <label htmlFor="work-calendar-search" className="sr-only">Search in result</label>
            <input
              id="work-calendar-search"
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="search in result"
              className="glass-input pl-9"
            />
          </div>
        </div>

        {loadError && (
          <div className="mb-3 rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{loadError}</div>
        )}

        {view === "list" ? (
          <div id="listView" className="table-wrap">
            <table className="work-table">
              <thead>
                <tr>
                  <th data-col="ticketNo" className={showTicketNo ? "" : "hidden-col"}>Ticket No</th>
                  <th>Type</th>
                  <th>Posting Date</th>
                  <th>Schedule</th>
                  <th>Status</th>
                  <th>ModelCode</th>
                  <th>Serial</th>
                  <th data-col="address" className={showAddress ? "" : "hidden-col"}>Address</th>
                  <th>Aging</th>
                  <th>Repair Type</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-slate-500 italic">Loading…</td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-slate-500 italic">No records found</td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr key={`${row.ticketNo}-${row.schedule}`}>
                      <td data-col="ticketNo" className={showTicketNo ? "text-left" : "hidden-col text-left"}>
                        <Link to="/ticket/$ticketNo" params={{ ticketNo: row.ticketNo }} className="ticket-link">
                          {row.ticketNo}
                        </Link>
                      </td>
                      <td>{row.type}</td>
                      <td>{row.postingDate}</td>
                      <td>{row.schedule}</td>
                      <td>{row.status}</td>
                      <td>{row.modelCode}</td>
                      <td>{row.serial || "-"}</td>
                      <td data-col="address" className={showAddress ? "text-left" : "hidden-col text-left"}>{row.address}</td>
                      <td>{row.aging}</td>
                      <td>{row.repairType}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div id="calendarView" className="work-calendar-grid is-active">
            <div className="work-calendar-head-row">
              <div className="work-calendar-period-head" />
              {WEEKDAY_LABELS.map((weekday) => (
                <div key={weekday} className="work-calendar-day-head">{weekday}</div>
              ))}
            </div>

            {calendarWeeks.length === 0 ? (
              <div className="work-calendar-empty-state">
                <div className="work-calendar-empty-state-title">No schedules</div>
                <div className="work-calendar-empty-state-copy">No records found</div>
              </div>
            ) : (
              calendarWeeks.map((week) => (
                <div key={week[0]?.key} className="work-calendar-week-block">
                  {["AM", "PM"].map((slot) => (
                    <div key={slot} className="work-calendar-row">
                      <div className="work-calendar-period-cell">{slot}</div>
                      {week.map((day) => {
                        const dayLabel = day.date.getDate();
                        const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;
                        const cellRows = rowsByDateAndSlot[`${formatDate(day.date)}|${slot}`] ?? [];
                        return (
                          <div
                            key={`${day.key}-${slot}`}
                            className={`work-calendar-cell ${day.currentMonth ? "" : "is-outside"} ${isWeekend ? "is-weekend" : ""}`}
                          >
                            <div className="work-calendar-cell-top">
                              <span className={`work-calendar-day-number ${day.currentMonth ? "" : "is-muted"} ${isWeekend ? "is-weekend" : ""}`}>
                                {dayLabel}
                              </span>
                            </div>
                            <div className="work-calendar-ticket-stack">
                              {cellRows.length === 0 ? (
                                <div className="work-calendar-empty">&nbsp;</div>
                              ) : (
                                cellRows.map((row) => (
                                  <Link
                                    key={`${row.ticketNo}-${day.key}-${slot}`}
                                    to="/ticket/$ticketNo"
                                    params={{ ticketNo: row.ticketNo }}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="work-calendar-ticket"
                                  >
                                    <span className={`work-calendar-ticket-no ${row.slot === "PM" ? "is-pm" : "is-am"}`}>
                                      {showTicketNo ? row.ticketNo : row.customer}
                                    </span>
                                    <span className="work-calendar-ticket-time">{row.scheduleTime}</span>
                                  </Link>
                                ))
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </main>
  );
}
