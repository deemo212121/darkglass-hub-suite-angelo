import { useMemo, useState, useEffect } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Home, ListFilter, Search } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, TECHS_FULL, pad, pick } from "@/components/shared";
import { TICKET_SEARCH_INDEX } from "@/lib/ticket-search";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

type CalendarRow = {
  engineer: string;
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

const ENGINEERS = ["Josh Malloch", "R. Mendoza", "M. Navarro", ...TECHS_FULL];
const SOURCE_TYPES = ["Delivery", "Installation", "Repair", "Maintenance", "Follow Up", "Inspection"];
const REPAIR_TYPES = ["Warranty", "Out of Warranty", "Claim", "Parts Hold", "Return Visit"];
const STATUS_TYPES = ["Scheduled", "In Progress", "Waiting Parts", "Complete", "Deferred"];
const MODEL_CODES = ["FRN-01", "WSH-02", "DRY-03", "RNG-04", "D/W-05", "MW-06"];
const STREET_NAMES = ["Main St", "Oak Ave", "Pine Rd", "Cedar Ln", "Market Dr", "Summit Way"];
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

function parseDate(dateValue: string) {
  const [month, day, year] = dateValue.split("/").map(Number);
  if (!month || !day || !year) return null;
  return new Date(year, month - 1, day);
}

function generateRows(monthValue: string): CalendarRow[] {
  const base = monthValue ? new Date(`${monthValue}-01T00:00:00`) : new Date();
  const year = base.getFullYear();
  const month = base.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const locations = LOCATIONS.slice(1);
  const ticketEntries = TICKET_SEARCH_INDEX.length
    ? TICKET_SEARCH_INDEX
    : [{ ticketNo: "TK-2026-0001", customer: "Sample Customer", city: "Asheville", zip: "", status: "Scheduled" }];

  return Array.from({ length: ticketEntries.length }, (_, index) => {
    const entry = ticketEntries[index % ticketEntries.length];
    const scheduleDay = 1 + ((index * 2 + month) % daysInMonth);
    const scheduleDate = new Date(year, month, scheduleDay);
    const postingDate = new Date(scheduleDate);
    postingDate.setDate(postingDate.getDate() - (2 + (index % 11)));
    const engineer = ENGINEERS[index % ENGINEERS.length];
    const city = pick(locations, index);
    const slot: "AM" | "PM" = index % 2 === 0 ? "AM" : "PM";
    const status = entry.status || pick(STATUS_TYPES, index);
    return {
      engineer,
      ticketNo: entry.ticketNo,
      customer: entry.customer,
      type: pick(SOURCE_TYPES, index),
      postingDate: formatDate(postingDate),
      schedule: formatDate(scheduleDate),
      slot,
      scheduleTime: slot === "AM" ? "09:30" : "14:30",
      status,
      modelCode: pick(MODEL_CODES, index),
      serial: `SN-${pad(3000 + index)}`,
      address: `${100 + index * 3} ${pick(STREET_NAMES, index)}, ${city}${entry.zip ? ` ${entry.zip}` : ""}`,
      aging: Math.max(0, Math.floor((Date.now() - postingDate.getTime()) / 86400000)),
      repairType: pick(REPAIR_TYPES, index),
    };
  });
}

export function WorkCalendarPage({ mod, sub }: Props) {
  const now = new Date();
  const [engineer, setEngineer] = useState("Josh Malloch");
  const [monthValue, setMonthValue] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [showTicketNo, setShowTicketNo] = useState(true);
  const [showAddress, setShowAddress] = useState(true);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [search, setSearch] = useState("");

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

  const rows = useMemo(() => generateRows(monthValue), [monthValue]);
  const calendarWeeks = useMemo(() => buildCalendarWeeks(monthValue), [monthValue]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (engineer && row.engineer !== engineer) return false;
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
  }, [rows, engineer, search]);

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
            <label htmlFor="engineer">Engineer</label>
            <select
              id="engineer"
              value={engineer}
              onChange={(event) => setEngineer(event.target.value)}
              className="glass-input"
            >
              {ENGINEERS.map((name) => (
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
                value={monthValue}
                onChange={(event) => setMonthValue(event.target.value.slice(0, 7))}
                inputMode="numeric"
                pattern="\\d{4}-\\d{2}"
                placeholder="YYYY-MM"
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
            {filteredRows.length} records found
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
                {filteredRows.length === 0 ? (
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