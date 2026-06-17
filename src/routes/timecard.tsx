import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useEffect } from "react";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useAuth } from "@/lib/auth";
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
