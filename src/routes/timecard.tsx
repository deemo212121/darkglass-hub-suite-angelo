import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, FileText, Download } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useAuth } from "@/lib/auth";
import { shouldUseMobile } from "@/lib/device";
import {
  getMonthEntries,
  saveEntry as sbSaveEntry,
  deleteEntry as sbDeleteEntry,
  getMyProfileSchedule,
} from "@/lib/supabase/timecards";

interface TimeEntry {
  checkIn: string;
  checkOut: string;
  mealStart: string;
  mealEnd: string;
  notes: string;
}

interface Entries {
  [key: string]: TimeEntry;
}

export const Route = createFileRoute("/timecard")({
  component: TimecardPage,
});

function TimecardPage() {
  const { uid, ready } = useAuth();

  // The mobile experience is stripped down for every role, not just techs.
  // Anyone on a phone (or with the mobile-mode sticky flag) gets the
  // simple pay-period table. Desktop / tablet users keep the full punch
  // grid regardless of role. This matches the general rule that mobile
  // and desktop UIs are intentionally different surfaces.
  //
  // We read from `shouldUseMobile()` directly so an SSR pass returns the
  // desktop UI and the client swaps on hydration; that avoids a mobile
  // flash on wider viewports.
  const [useMobile, setUseMobile] = useState(false);
  useEffect(() => {
    setUseMobile(shouldUseMobile());
  }, []);
  if (useMobile) {
    return <MobilePayrollPage />;
  }

  return <FullTimecardPage uid={uid} ready={ready} />;
}

function FullTimecardPage({ uid, ready }: { uid: string | null; ready: boolean }) {
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [entries, setEntries] = useState<Entries>({});
  const [profileId, setProfileId] = useState<string | null>(null);
  const [requiredCheckIn, setRequiredCheckIn] = useState("");
  const [requiredCheckOut, setRequiredCheckOut] = useState("");
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [modalEntry, setModalEntry] = useState<TimeEntry | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const navigate = useNavigate();

  // Resolve the caller's profile id + scheduled shift once auth is ready.
  useEffect(() => {
    if (!ready || !uid) return;
    let cancelled = false;
    getMyProfileSchedule(uid)
      .then((s) => {
        if (cancelled) return;
        setProfileId(s.profileId);
        setRequiredCheckIn(s.requiredCheckIn);
        setRequiredCheckOut(s.requiredCheckOut);
      })
      .catch((err) => console.error("Failed to resolve profile:", err));
    return () => { cancelled = true; };
  }, [ready, uid]);

  // Load the visible month's entries from Supabase.
  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    getMonthEntries(profileId, currentYear, currentMonth)
      .then((map) => { if (!cancelled) setEntries(map); })
      .catch((err) => {
        console.error("Failed to load timecard:", err);
        if (!cancelled) setEntries({});
      });
    return () => { cancelled = true; };
  }, [profileId, currentYear, currentMonth]);

  const changeMonth = (dir: number) => {
    let newMonth = currentMonth + dir;
    let newYear = currentYear;
    if (newMonth > 11) {
      newMonth = 0;
      newYear++;
    }
    if (newMonth < 0) {
      newMonth = 11;
      newYear--;
    }
    setCurrentMonth(newMonth);
    setCurrentYear(newYear);
  };

  const goToToday = () => {
    const now = new Date();
    setCurrentYear(now.getFullYear());
    setCurrentMonth(now.getMonth());
  };

  const toKey = (date: Date): string => {
    return (
      date.getFullYear() +
      "-" +
      String(date.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(date.getDate()).padStart(2, "0")
    );
  };

  const getNowTime = (): string => {
    const now = new Date();
    return (
      String(now.getHours()).padStart(2, "0") +
      ":" +
      String(now.getMinutes()).padStart(2, "0")
    );
  };

  const timeDiff = (t1: string, t2: string): number => {
    if (!t1 || !t2) return 0;
    const [h1, m1] = t1.split(":").map(Number);
    const [h2, m2] = t2.split(":").map(Number);
    return ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60;
  };

  const calcHours = (entry: TimeEntry): number => {
    if (!entry || !entry.checkIn || !entry.checkOut) return 0;
    let hrs = timeDiff(entry.checkIn, entry.checkOut);
    if (entry.mealStart && entry.mealEnd) {
      hrs -= timeDiff(entry.mealStart, entry.mealEnd);
    }
    return Math.max(0, hrs);
  };

  const getWeekNumber = (date: Date): number => {
    const d = new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
    );
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  };

  const fmtDate = (date: Date): string => {
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return months[date.getMonth()] + " " + date.getDate();
  };

  const openEntryModal = (dateKey: string) => {
    setEditingDate(dateKey);
    const entry = entries[dateKey] || {
      checkIn: "",
      checkOut: "",
      mealStart: "",
      mealEnd: "",
      notes: "",
    };
    setModalEntry(entry);
    setModalOpen(true);
  };

  const closeEntryModal = () => {
    setModalOpen(false);
    setEditingDate(null);
    setModalEntry(null);
  };

  const saveEntry = async () => {
    if (!editingDate || !modalEntry) return;
    // Optimistic local update
    const newEntries = { ...entries, [editingDate]: modalEntry };
    setEntries(newEntries);
    if (!profileId) {
      alert("Could not resolve your profile. Please re-login.");
      return;
    }
    try {
      await sbSaveEntry(profileId, editingDate, modalEntry);
    } catch (err) {
      console.error("Failed to save entry:", err);
      alert(`Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleTimeToggle = () => {
    if (!modalEntry) return;
    if (!modalEntry.checkIn) {
      setModalEntry({ ...modalEntry, checkIn: getNowTime() });
    } else if (!modalEntry.checkOut) {
      setModalEntry({ ...modalEntry, checkOut: getNowTime() });
    }
  };

  const handleMealToggle = () => {
    if (!modalEntry) return;
    if (!modalEntry.checkIn) {
      alert("Please log time in first.");
      return;
    }

    // Lunch eligibility is based on the SCHEDULED shift length (set at account
    // creation), not actual hours worked. Lunch is allowed only if the scheduled
    // shift is 8 hours or more.
    const scheduledShift = timeDiff(requiredCheckIn, requiredCheckOut);
    if (!requiredCheckIn || !requiredCheckOut) {
      alert("No scheduled shift is set for your account. Contact your admin to set your required schedule.");
      return;
    }
    if (scheduledShift < 8) {
      alert(`Lunch break is only available for scheduled shifts of 8 hours or more. Your scheduled shift is ${scheduledShift.toFixed(1)} hours.`);
      return;
    }

    if (!modalEntry.mealStart) {
      setModalEntry({ ...modalEntry, mealStart: getNowTime() });
    } else if (!modalEntry.mealEnd) {
      setModalEntry({ ...modalEntry, mealEnd: getNowTime() });
    }
  };

  const deleteEntry = async () => {
    if (!editingDate || !entries[editingDate]) return;
    if (!confirm("Delete time entry for this day?")) return;
    const newEntries = { ...entries };
    delete newEntries[editingDate];
    setEntries(newEntries);
    if (profileId) {
      try {
        await sbDeleteEntry(profileId, editingDate);
      } catch (err) {
        console.error("Failed to delete entry:", err);
      }
    }
    closeEntryModal();
  };

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const firstDay = new Date(currentYear, currentMonth, 1);
  const lastDay = new Date(currentYear, currentMonth + 1, 0);
  const today = new Date();

  // Build calendar
  let cursor = new Date(firstDay);
  cursor.setDate(cursor.getDate() - cursor.getDay());

  const calendarDays: (Date | null)[] = [];
  const end = new Date(lastDay);
  end.setDate(end.getDate() + (6 - end.getDay()));

  while (cursor <= end) {
    calendarDays.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  // Summary
  let totalDays = 0,
    totalHrs = 0,
    totalMeal = 0;
  const prefix = currentYear + "-" + String(currentMonth + 1).padStart(2, "0");

  for (const [key, entry] of Object.entries(entries)) {
    if (!key.startsWith(prefix)) continue;
    const hrs = calcHours(entry);
    if (hrs > 0 || entry.checkIn) {
      totalDays++;
      totalHrs += hrs;
      if (entry.mealStart && entry.mealEnd) {
        totalMeal += timeDiff(entry.mealStart, entry.mealEnd);
      }
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-950">
      <AppHeader />

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate({ to: "/" })}
              className="btn p-2 hover:bg-white/10 rounded-md transition"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h1 className="text-3xl font-bold text-white">My Timecard</h1>
          </div>

          {/* Nav + Summary Panel */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => changeMonth(-1)}
                  className="p-2 hover:bg-white/10 rounded-md transition"
                  title="Previous month"
                >
                  <ChevronLeft className="h-5 w-5 text-slate-300" />
                </button>
                <h2 className="text-2xl font-bold text-white min-w-48 text-center">
                  {monthNames[currentMonth]} {currentYear}
                </h2>
                <button
                  onClick={() => changeMonth(1)}
                  className="p-2 hover:bg-white/10 rounded-md transition"
                  title="Next month"
                >
                  <ChevronRight className="h-5 w-5 text-slate-300" />
                </button>
              </div>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white/5 rounded-lg p-4 border border-white/5">
                <p className="text-xs text-slate-400 font-semibold mb-2">Days Worked</p>
                <p className="text-2xl font-bold text-blue-300">{totalDays}</p>
              </div>
              <div className="bg-white/5 rounded-lg p-4 border border-white/5">
                <p className="text-xs text-slate-400 font-semibold mb-2">Total Hours</p>
                <p className="text-2xl font-bold text-green-300">
                  {totalHrs.toFixed(1)}h
                </p>
              </div>
              <div className="bg-white/5 rounded-lg p-4 border border-white/5">
                <p className="text-xs text-slate-400 font-semibold mb-2">Meal Break</p>
                <p className="text-2xl font-bold text-orange-300">
                  {totalMeal.toFixed(1)}h
                </p>
              </div>
              <div className="bg-white/5 rounded-lg p-4 border border-white/5">
                <p className="text-xs text-slate-400 font-semibold mb-2">Net Hours</p>
                <p className="text-2xl font-bold text-purple-300">
                  {totalHrs.toFixed(1)}h
                </p>
              </div>
            </div>
          </div>

          {/* Calendar */}
          <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
            <table className="w-full border-collapse table-fixed">
              <thead>
                <tr className="h-10">
                  <th className="text-xs font-semibold text-slate-400 p-2 text-center">Sun</th>
                  <th className="text-xs font-semibold text-slate-400 p-2 text-center">Mon</th>
                  <th className="text-xs font-semibold text-slate-400 p-2 text-center">Tue</th>
                  <th className="text-xs font-semibold text-slate-400 p-2 text-center">Wed</th>
                  <th className="text-xs font-semibold text-slate-400 p-2 text-center">Thu</th>
                  <th className="text-xs font-semibold text-slate-400 p-2 text-center">Fri</th>
                  <th className="text-xs font-semibold text-slate-400 p-2 text-center">Sat</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: Math.ceil(calendarDays.length / 7) }).map((_, weekIdx) => {
                  const weekDays = calendarDays.slice(weekIdx * 7, (weekIdx + 1) * 7);
                  return (
                    <tr key={weekIdx} className="h-20">
                      {weekDays.map((day, dayIdx) => {
                        if (!day) {
                          return <td key={dayIdx} className="p-2 border border-white/5" />;
                        }

                        const dateKey = toKey(day);
                        const entry = entries[dateKey];
                        const isToday = day.toDateString() === today.toDateString();
                        const isOtherMonth = day.getMonth() !== currentMonth;
                        const hrs = entry ? calcHours(entry) : 0;

                        return (
                          <td
                            key={dateKey}
                            onClick={() => openEntryModal(dateKey)}
                            className={`p-2 border text-sm cursor-pointer transition overflow-hidden ${
                              isOtherMonth
                                ? "opacity-20 border-white/5"
                                : isToday
                                  ? "border-blue-500 bg-blue-500/5"
                                  : entry
                                    ? "border-green-500/30 bg-green-500/5"
                                    : "border-white/10 hover:bg-white/5"
                            }`}
                          >
                            <div className="font-semibold text-white text-xs mb-0.5">{day.getDate()}</div>
                            {entry && !isOtherMonth && (
                              <div className="text-xs space-y-0.5">
                                {entry.checkIn && (
                                  <div className="bg-green-500/40 text-green-100 px-1 py-0.5 rounded text-xs line-clamp-1">
                                    ✓ {entry.checkIn}
                                  </div>
                                )}
                                {entry.mealStart && entry.mealEnd && (
                                  <div className="bg-orange-500/40 text-orange-100 px-1 py-0.5 rounded text-xs line-clamp-1">
                                    🍽 {entry.mealStart}-{entry.mealEnd}
                                  </div>
                                )}
                                {entry.checkOut && (
                                  <div className="bg-red-500/40 text-red-100 px-1 py-0.5 rounded text-xs line-clamp-1">
                                    ✕ {entry.checkOut}
                                  </div>
                                )}
                                {hrs > 0 && (
                                  <div className="bg-blue-500/40 text-blue-100 px-1 py-0.5 rounded text-xs font-semibold line-clamp-1">
                                    {hrs.toFixed(1)}h
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Modal */}
          {modalOpen && editingDate && modalEntry && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={closeEntryModal}>
              <div className="bg-slate-800 border border-white/10 rounded-lg w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-white/10">
                  <div>
                    <h3 className="text-lg font-bold text-white">Log Time Entry</h3>
                    <p className="text-xs text-slate-400 mt-1">{editingDate}</p>
                  </div>
                  <button
                    onClick={closeEntryModal}
                    className="text-slate-400 hover:text-white transition p-1"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4">
                  {/* Time Section */}
                  <div>
                    <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                      Work Time
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
                        <p className="text-xs text-slate-400 mb-1">Check In</p>
                        <p className="text-lg font-semibold text-green-300">{modalEntry.checkIn || "—"}</p>
                      </div>
                      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                        <p className="text-xs text-slate-400 mb-1">Check Out</p>
                        <p className="text-lg font-semibold text-red-300">{modalEntry.checkOut || "—"}</p>
                      </div>
                    </div>
                  </div>

                  {/* Meal Section */}
                  <div>
                    <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
                      Meal Break
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3">
                        <p className="text-xs text-slate-400 mb-1">Start</p>
                        <p className="text-lg font-semibold text-orange-300">{modalEntry.mealStart || "—"}</p>
                      </div>
                      <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3">
                        <p className="text-xs text-slate-400 mb-1">End</p>
                        <p className="text-lg font-semibold text-orange-300">{modalEntry.mealEnd || "—"}</p>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  {(() => {
                    const todayKey = (() => {
                      const t = new Date();
                      return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
                    })();
                    const isToday = editingDate === todayKey;
                    const isPast = editingDate < todayKey;
                    if (!isToday) {
                      return (
                        <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-3 text-xs text-amber-200">
                          {isPast
                            ? "Time-in / time-out for past dates is locked. Open My Timecard on the actual day to log your hours."
                            : "You can only log time-in / time-out on today's date."}
                        </div>
                      );
                    }
                    return (
                      <div className="flex gap-2 pt-4">
                        <button
                          onClick={() => {
                            if (!modalEntry.checkIn) {
                              handleTimeToggle();
                            } else if (!modalEntry.checkOut) {
                              handleTimeToggle();
                            }
                          }}
                          className="flex-1 px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:opacity-50 text-white rounded-lg font-semibold transition"
                          disabled={!!modalEntry.checkOut}
                        >
                          {!modalEntry.checkIn
                            ? "🕐 Time In"
                            : !modalEntry.checkOut
                              ? "🛑 Time Out"
                              : "✓ Done"}
                        </button>
                        <button
                          onClick={() => {
                            if (!modalEntry.mealStart) {
                              handleMealToggle();
                            } else if (!modalEntry.mealEnd) {
                              handleMealToggle();
                            }
                          }}
                          className="flex-1 px-4 py-3 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-600 disabled:opacity-50 text-white rounded-lg font-semibold transition"
                          disabled={!!modalEntry.mealEnd}
                        >
                          {!modalEntry.mealStart
                            ? "🍽 Meal In"
                            : !modalEntry.mealEnd
                              ? "✓ Meal Out"
                              : "Done"}
                        </button>
                      </div>
                    );
                  })()}
                </div>

                {/* Footer */}
                <div className="flex gap-2 p-6 border-t border-white/10">
                  <button
                    onClick={() => {
                      saveEntry();
                      closeEntryModal();
                    }}
                    className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Mobile payroll — simplified view for every role on phone
// ══════════════════════════════════════════════════════════════════════
// The mobile app surface is intentionally different from desktop. On a
// phone we don't ask any user (tech, CSR, or otherwise) to punch in /
// punch out — that flow lives on desktop only. Mobile users get the
// bi-weekly pay-period table: Date | Pay Amount | Status | Action.
// Data comes from a synthetic seed today; swap the `useMemo` block for
// a Supabase fetch when the payroll table lands and the rest of the UI
// keeps working unchanged.

interface MobilePayRow {
  id: string;
  periodLabel: string;
  periodEnd: string;
  amount: number;
  status: "Paid" | "Pending" | "Processing" | "On Hold";
}

function MobilePayrollPage() {
  const navigate = useNavigate();
  const { email, displayName } = useAuth();

  // Seed 12 recent bi-weekly periods, most recent first. Amounts fluctuate
  // so the table isn't uniform. Status skews to "Paid" for older periods,
  // "Processing"/"Pending" for the most recent ones.
  const rows = useMemo<MobilePayRow[]>(() => {
    const out: MobilePayRow[] = [];
    const today = new Date();
    // Start from the current pay-period end, walk back in 14-day steps.
    const endDate = new Date(today);
    for (let i = 0; i < 12; i += 1) {
      const start = new Date(endDate);
      start.setDate(endDate.getDate() - 13);
      const label =
        start.toLocaleDateString("en-US") + " – " + endDate.toLocaleDateString("en-US");
      const iso = endDate.toISOString().slice(0, 10);
      // Amount: base $850 + $50 × (index * 7 % 10) so the numbers vary.
      const amount = 850 + ((i * 137) % 620);
      let status: MobilePayRow["status"];
      if (i === 0) status = "Processing";
      else if (i === 1) status = "Pending";
      else if (i === 4) status = "On Hold";
      else status = "Paid";
      out.push({
        id: "TP-" + iso,
        periodLabel: label,
        periodEnd: iso,
        amount,
        status,
      });
      endDate.setDate(endDate.getDate() - 14);
    }
    return out;
  }, []);

  const displayLabel = displayName || email || "User";

  const statusPill = (status: MobilePayRow["status"]) => {
    const map: Record<MobilePayRow["status"], { bg: string; text: string; border: string }> = {
      Paid: { bg: "bg-emerald-500/15", text: "text-emerald-300", border: "border-emerald-400/40" },
      Pending: { bg: "bg-amber-500/15", text: "text-amber-300", border: "border-amber-400/40" },
      Processing: { bg: "bg-blue-500/15", text: "text-blue-300", border: "border-blue-400/40" },
      "On Hold": { bg: "bg-rose-500/15", text: "text-rose-300", border: "border-rose-400/40" },
    };
    const c = map[status];
    return (
      <span
        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${c.bg} ${c.text} ${c.border}`}
      >
        {status}
      </span>
    );
  };

  const totalPaid = rows
    .filter((r) => r.status === "Paid")
    .reduce((sum, r) => sum + r.amount, 0);
  const totalPending = rows
    .filter((r) => r.status !== "Paid")
    .reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="min-h-screen flex flex-col bg-slate-950">
      <AppHeader />
      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-8">
        <div className="mb-6 flex items-center gap-4">
          <button
            onClick={() => navigate({ to: "/" })}
            className="btn p-2 hover:bg-white/10 rounded-md transition"
            aria-label="Back"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">My Payroll</h1>
            <p className="text-sm text-slate-400">{displayLabel}</p>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
          <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              YTD Paid (last 12 periods)
            </p>
            <p className="mt-1 text-2xl font-bold text-emerald-300">
              ${totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Pending</p>
            <p className="mt-1 text-2xl font-bold text-amber-300">
              ${totalPending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Pay Periods</p>
            <p className="mt-1 text-2xl font-bold text-blue-300">{rows.length}</p>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-lg border border-white/10 bg-slate-900/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Date</th>
                  <th className="px-4 py-3 text-right font-semibold">Pay Amount</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-white/5 hover:bg-white/[0.03] transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{row.periodLabel}</div>
                      <div className="text-xs text-slate-400">Ended {row.periodEnd}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-white">
                      ${row.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3">{statusPill(row.status)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-md border border-blue-400/40 bg-blue-500/15 px-2.5 py-1 text-xs font-semibold text-blue-200 hover:bg-blue-500/25 transition"
                          title="View payroll details"
                          onClick={() =>
                            alert(
                              `Pay period ${row.periodLabel}\nAmount: $${row.amount.toFixed(2)}\nStatus: ${row.status}`,
                            )
                          }
                        >
                          <FileText className="h-3 w-3" />
                          View
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 transition disabled:opacity-40 disabled:cursor-not-allowed"
                          title={row.status === "Paid" ? "Download pay stub" : "Available after payment"}
                          disabled={row.status !== "Paid"}
                          onClick={() =>
                            alert(
                              `Pay stub for ${row.periodLabel} will be available once your finance team publishes it.`,
                            )
                          }
                        >
                          <Download className="h-3 w-3" />
                          Stub
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          Payroll is issued per pay period. If an amount looks wrong, reach out to your branch manager or HR.
        </p>
      </main>
      <Footer />
    </div>
  );
}
