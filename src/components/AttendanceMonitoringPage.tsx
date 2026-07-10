import { AlertCircle, AlertTriangle, Clock, Users, UserCheck, UserX, Bell, MessageSquare, ChevronLeft, Download, Calendar, FileText, CheckCircle, XCircle } from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { getCompanyUsers, getProfileEmployeeInfo, type ProfileRow } from "@/lib/supabase/users";
import { ROLE_LABELS, canSubmitConductNote } from "@/lib/roleLabels";
import { addAgentNote, getAllAgentNotes, type CsrAgentNote } from "@/lib/supabase/csrAgentNotes";
import {
  getCompanyTimecardEntries,
  getProfileIdByFirebaseUid,
  calcWorkedHours,
  hoursDiff,
  type CompanyTimecardEntry,
} from "@/lib/supabase/timecards";
import { getAttendanceNotes, upsertAttendanceNote } from "@/lib/supabase/attendanceNotes";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { resolveTeamLeadOrManager } from "@/lib/notifyRouting";
import {
  getCompanyPtoRequests,
  createPtoRequest,
  reviewPtoStage,
  canReviewPtoStage,
  isEligibleForPto,
  ptoEligibleDate,
  type PtoRequestRow,
  type PtoType,
  type PtoStage,
} from "@/lib/supabase/pto";
import {
  getCompanyTimecardCorrections,
  getCompanyTimecardCorrectionHistory,
  createTimecardCorrection,
  approveTimecardCorrection,
  rejectTimecardCorrection,
  type TimecardCorrectionRow,
  type TimecardCorrectionHistoryRow,
} from "@/lib/supabase/timecardCorrections";

interface DailyRecord {
  profileId: string;
  name: string;
  email: string;
  location: string;
  department: string;
  manager: string;
  checkIn: string;
  mealIn: string;
  mealOut: string;
  checkOut: string;
  alerts: string[];
  isOffDay: boolean;
}

const PTO_TYPE_LABELS: Record<PtoType, string> = {
  vacation: "Vacation",
  sick: "Sick",
  personal: "Personal",
  holiday: "Holiday",
  unpaid: "Unpaid",
  bereavement: "Bereavement",
};

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mondayOf(d: Date): Date {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function fmtHoursMinutes(hours: number): string {
  const totalMinutes = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

/**
 * Off-day indices follow the same convention timecards.ts already uses
 * company-wide (getCompanyTimecardWarnings / getAttendanceForRange):
 * JS Date.getDay() — 0=Sunday..6=Saturday.
 */
function computeAlerts(
  checkIn: string,
  checkOut: string,
  mealStart: string,
  mealEnd: string,
  requiredCheckIn: string,
  requiredCheckOut: string,
  isOffDay: boolean
): string[] {
  if (!checkIn && !checkOut) {
    return isOffDay ? [] : ["Absent", "No Clock In"];
  }
  const alerts: string[] = [];
  if (!checkIn) alerts.push("No Clock In");
  else if (requiredCheckIn && checkIn > requiredCheckIn) alerts.push("Late Check In");
  if (checkIn && !checkOut) alerts.push("No Clock Out");
  if (checkIn && checkOut) {
    const worked = calcWorkedHours({ checkIn, checkOut, mealStart, mealEnd, notes: "" });
    const requiredHours = requiredCheckIn && requiredCheckOut ? hoursDiff(requiredCheckIn, requiredCheckOut) : 8;
    if (worked - requiredHours > 0.25) alerts.push(`Over Time (${fmtHoursMinutes(worked)})`);
    else if (requiredHours - worked > 0.25) alerts.push(`Under Time (${fmtHoursMinutes(worked)})`);
  }
  return alerts;
}

export function AttendanceMonitoringPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const { uid, ready, allowedLocations, displayName, role } = useAuth();
  // Attendance notes can only be created/edited by HR, Finance, or Admin —
  // other roles that can view this page (e.g. BizOps Manager) can't.
  const canManageNotes = ["ADMIN", "HR", "FINANCE"].includes((role || "").toUpperCase());
  // Warnings tab reuses the same conduct-note workflow as CsrAgentDetailPage
  // (employee_conduct_notes, reviewed on the HR Warnings & Mistakes tab) —
  // any manager-flavored role can submit one here for a tardy employee, but
  // unlike CsrAgentDetailPage it never fast-tracks to approved: every
  // submission from this tab always waits on HR review.
  const canWarn = ready && canSubmitConductNote(role);

  const [loading, setLoading] = useState(true);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [entries, setEntries] = useState<CompanyTimecardEntry[]>([]);
  const [ptoRequests, setPtoRequests] = useState<PtoRequestRow[]>([]);
  const [corrections, setCorrections] = useState<TimecardCorrectionRow[]>([]);
  const [correctionHistory, setCorrectionHistory] = useState<TimecardCorrectionHistoryRow[]>([]);

  const [activeTab, setActiveTab] = useState<"daily-attendance" | "pto-management" | "corrections" | "warnings">("daily-attendance");
  const [summaryView, setSummaryView] = useState<"weekly" | "monthly">("weekly");
  const [searchEmployee, setSearchEmployee] = useState<string>("");
  const [filterDepartment, setFilterDepartment] = useState<string>("all");
  const [summaryDepartmentFilter, setSummaryDepartmentFilter] = useState<string>("all");
  const [filterLocation, setFilterLocation] = useState<string>("all");
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [selectedCorrection, setSelectedCorrection] = useState<TimecardCorrectionRow | null>(null);
  const [correctionTimecardData, setCorrectionTimecardData] = useState<{ checkIn: string; checkOut: string; mealStart: string; mealEnd: string }>({ checkIn: "", checkOut: "", mealStart: "", mealEnd: "" });
  const [notesData, setNotesData] = useState<Record<string, { content: string; notifyIndividual: boolean; notifyTeamLead: boolean }>>({});
  const [newNote, setNewNote] = useState("");
  const [notifyIndividual, setNotifyIndividual] = useState(false);
  const [notifyTeamLead, setNotifyTeamLead] = useState(false);
  const [alertModalOpen, setAlertModalOpen] = useState(false);
  const [selectedAlertType, setSelectedAlertType] = useState<"missing-clockin" | "missing-clockout" | "late-arrival" | null>(null);
  const [showPtoForm, setShowPtoForm] = useState(false);
  const [ptoForm, setPtoForm] = useState({ profileId: "", ptoType: "vacation" as PtoType, startDate: "", endDate: "", reason: "" });
  const [ptoFormHireDate, setPtoFormHireDate] = useState<string | null>(null);
  const [showCorrectionForm, setShowCorrectionForm] = useState(false);
  const [correctionForm, setCorrectionForm] = useState({ profileId: "", workDate: "", correctedCheckIn: "", correctedCheckOut: "", correctedMealStart: "", correctedMealEnd: "", reason: "" });
  const [conductNotes, setConductNotes] = useState<CsrAgentNote[]>([]);
  const [warnSearch, setWarnSearch] = useState("");
  const [warnTarget, setWarnTarget] = useState<{ profileId: string; name: string } | null>(null);
  const [warnText, setWarnText] = useState("");
  const [warnSaving, setWarnSaving] = useState(false);

  const todayISO = useMemo(() => toISODate(new Date()), []);
  const { rangeStart, rangeEnd } = useMemo(() => {
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const weekStart = mondayOf(today);
    const start = weekStart < monthStart ? weekStart : monthStart;
    return { rangeStart: toISODate(start), rangeEnd: todayISO };
  }, [todayISO]);

  const loadAll = useCallback(async () => {
    if (!ready || !uid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [profileId, profileRows, entryRows, noteRows, ptoRows, correctionRows, historyRows, conductNoteRows] = await Promise.all([
        getProfileIdByFirebaseUid(uid),
        getCompanyUsers(),
        getCompanyTimecardEntries(rangeStart, rangeEnd),
        getAttendanceNotes(todayISO, todayISO),
        getCompanyPtoRequests(),
        getCompanyTimecardCorrections(),
        getCompanyTimecardCorrectionHistory(),
        getAllAgentNotes().catch(() => []),
      ]);
      setMyProfileId(profileId);
      setProfiles(profileRows);
      setEntries(entryRows);
      const noteMap: Record<string, { content: string; notifyIndividual: boolean; notifyTeamLead: boolean }> = {};
      noteRows.forEach((n) => {
        noteMap[n.profileId] = { content: n.content, notifyIndividual: n.notifyIndividual, notifyTeamLead: n.notifyTeamLead };
      });
      setNotesData(noteMap);
      setPtoRequests(ptoRows);
      setCorrections(correctionRows);
      setCorrectionHistory(historyRows);
      setConductNotes(conductNoteRows);
    } catch (error) {
      console.error("Failed to load attendance data:", error);
    } finally {
      setLoading(false);
    }
  }, [ready, uid, rangeStart, rangeEnd, todayISO]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // PTO eligibility for whoever is selected in the New PTO Request form —
  // hire date lives in profiles.employee_info, fetched on demand per
  // selection rather than bulk-loaded for the whole roster.
  useEffect(() => {
    if (!ptoForm.profileId) {
      setPtoFormHireDate(null);
      return;
    }
    let cancelled = false;
    getProfileEmployeeInfo(ptoForm.profileId).then((info) => {
      if (!cancelled) setPtoFormHireDate(info?.hireDate || null);
    });
    return () => { cancelled = true; };
  }, [ptoForm.profileId]);

  const allProfileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const profileName = (id: string | null) => {
    if (!id) return "—";
    const p = allProfileById.get(id);
    return p?.display_name || p?.email || "—";
  };

  const visibleProfiles = useMemo(() => {
    if (allowedLocations === null) return profiles;
    return profiles.filter((p) => allowedLocations.includes(p.assigned_branch || ""));
  }, [profiles, allowedLocations]);

  const entriesByKey = useMemo(() => {
    const map = new Map<string, CompanyTimecardEntry>();
    entries.forEach((e) => map.set(`${e.profileId}|${e.workDate}`, e));
    return map;
  }, [entries]);

  const dailyRecords: DailyRecord[] = useMemo(() => {
    const dow = new Date(todayISO + "T00:00:00").getDay();
    return visibleProfiles.map((p) => {
      const entry = entriesByKey.get(`${p.id}|${todayISO}`);
      const offDays = new Set<number>(p.off_days ?? []);
      const isOffDay = offDays.has(dow);
      const checkIn = entry?.checkIn || "";
      const checkOut = entry?.checkOut || "";
      const mealIn = entry?.mealStart || "";
      const mealOut = entry?.mealEnd || "";
      const alerts = computeAlerts(checkIn, checkOut, mealIn, mealOut, p.required_check_in || "", p.required_check_out || "", isOffDay);
      return {
        profileId: p.id,
        name: p.display_name || p.email,
        email: p.email,
        location: p.assigned_branch || "",
        department: p.department || ROLE_LABELS[p.role] || p.role || "",
        manager: p.manager_name || "",
        checkIn: checkIn || "—",
        mealIn: mealIn || "—",
        mealOut: mealOut || "—",
        checkOut: checkOut || "—",
        alerts,
        isOffDay,
      };
    });
  }, [visibleProfiles, entriesByKey, todayISO]);

  const totalEmployees = visibleProfiles.length;
  const presentToday = dailyRecords.filter((r) => r.checkIn !== "—").length;
  const absentToday = dailyRecords.filter((r) => r.checkIn === "—" && !r.isOffDay).length;
  const lateToday = dailyRecords.filter((r) => r.alerts.some((a) => a.includes("Late"))).length;
  const ptoPendingApproval = ptoRequests.filter((r) => r.status === "pending").length;

  const getAlertColor = (alert: string) => {
    if (alert.includes("Over Time")) return "bg-blue-500/20 text-blue-300 border-blue-500/30";
    if (alert.includes("Under Time")) return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
    if (alert.includes("Late")) return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
    return "bg-red-500/20 text-red-300 border-red-500/30";
  };

  const filteredAndSortedData = dailyRecords
    .filter((record) => {
      if (searchEmployee && !record.name.toLowerCase().includes(searchEmployee.toLowerCase())) return false;
      if (filterDepartment !== "all" && record.department !== filterDepartment) return false;
      if (filterLocation !== "all" && record.location !== filterLocation) return false;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const profileDepartment = (p: ProfileRow) => p.department || ROLE_LABELS[p.role] || p.role || "";

  const departments = Array.from(
    new Set(visibleProfiles.map(profileDepartment).filter(Boolean))
  ) as string[];
  const locations = Array.from(new Set(visibleProfiles.map((p) => p.assigned_branch).filter(Boolean))) as string[];

  // Weekly/Monthly summary tables get their own department filter since
  // they're a separate section below the Daily Attendance table/filters.
  const summaryProfiles = useMemo(
    () => summaryDepartmentFilter === "all"
      ? visibleProfiles
      : visibleProfiles.filter((p) => profileDepartment(p) === summaryDepartmentFilter),
    [visibleProfiles, summaryDepartmentFilter]
  );

  // ---- Weekly summary (Mon–Fri of the current week) ----
  const weekDates = useMemo(() => {
    const monday = mondayOf(new Date());
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return toISODate(d);
    });
  }, []);

  const weeklySummary = useMemo(() => {
    return summaryProfiles.map((p) => {
      const offDays = new Set<number>(p.off_days ?? []);
      let presentCount = 0;
      let workingDays = 0;
      const cells = weekDates.map((iso) => {
        const dow = new Date(iso + "T00:00:00").getDay();
        if (offDays.has(dow)) return "off" as const;
        if (iso > todayISO) return "future" as const;
        workingDays++;
        const entry = entriesByKey.get(`${p.id}|${iso}`);
        const present = Boolean(entry?.checkIn);
        if (present) presentCount++;
        return present ? ("present" as const) : ("absent" as const);
      });
      const pct = workingDays > 0 ? Math.round((presentCount / workingDays) * 100) : 100;
      return { profileId: p.id, name: p.display_name || p.email, cells, presentCount, workingDays, pct };
    });
  }, [summaryProfiles, weekDates, entriesByKey, todayISO]);

  // ---- Monthly summary (month-to-date) ----
  const monthlySummary = useMemo(() => {
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    return summaryProfiles.map((p) => {
      const offDays = new Set<number>(p.off_days ?? []);
      let workingDays = 0;
      let present = 0;
      let late = 0;
      for (let d = new Date(monthStart); d <= today; d.setDate(d.getDate() + 1)) {
        const iso = toISODate(d);
        const dow = d.getDay();
        if (offDays.has(dow)) continue;
        workingDays++;
        const entry = entriesByKey.get(`${p.id}|${iso}`);
        const checkIn = entry?.checkIn || "";
        const checkOut = entry?.checkOut || "";
        if (checkIn) present++;
        const alerts = computeAlerts(checkIn, checkOut, entry?.mealStart || "", entry?.mealEnd || "", p.required_check_in || "", p.required_check_out || "", false);
        if (alerts.some((a) => a.includes("Late"))) late++;
      }
      const absent = Math.max(0, workingDays - present);
      const pct = workingDays > 0 ? Math.round((present / workingDays) * 100) : 100;
      const status = pct >= 90 ? "Good" : pct >= 70 ? "Warning" : "Poor";
      return { profileId: p.id, name: p.display_name || p.email, workingDays, present, absent, late, pct, status };
    });
  }, [summaryProfiles, entriesByKey]);

  // ---- Warnings tab: month-to-date late counts, tardiest first ----
  const warnEmployees = useMemo(() => {
    const q = warnSearch.trim().toLowerCase();
    return monthlySummary
      .filter((row) => !q || row.name.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => b.late - a.late || a.name.localeCompare(b.name));
  }, [monthlySummary, warnSearch]);

  const handleSubmitWarning = async () => {
    if (!warnTarget) return;
    if (!warnText.trim()) {
      alert("Please enter a warning note.");
      return;
    }
    setWarnSaving(true);
    try {
      // Always routes through HR review, even for HR/Admin/Superadmin
      // submitters — unlike CsrAgentDetailPage, tardiness warnings issued
      // here should never auto-approve themselves.
      await addAgentNote({
        agentProfileId: warnTarget.profileId,
        type: "warning",
        note: warnText.trim(),
      });
      setConductNotes(await getAllAgentNotes().catch(() => conductNotes));
      setWarnTarget(null);
      setWarnText("");
    } catch (error) {
      alert(`Failed to submit warning: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setWarnSaving(false);
    }
  };

  const handleDownloadSummary = () => {
    const today = todayISO;
    let csvContent = "Attendance Summary Report\n";
    csvContent += `Date: ${today}\n\n`;
    csvContent += "Key Metrics\n";
    csvContent += `Total Employees,${totalEmployees}\n`;
    csvContent += `Present Today,${presentToday}\n`;
    csvContent += `Absent Today,${absentToday}\n`;
    csvContent += `Late Today,${lateToday}\n\n`;
    csvContent += "Daily Attendance Tracker\n";
    csvContent += "Employee Name,Location,Department,Manager,Check In,Meal In,Meal Out,Check Out,Alerts,Notes\n";
    dailyRecords.forEach((record) => {
      const alerts = record.alerts.join("; ");
      const notes = notesData[record.profileId]?.content || "";
      csvContent += `"${record.name}","${record.location}","${record.department}","${record.manager}","${record.checkIn}","${record.mealIn}","${record.mealOut}","${record.checkOut}","${alerts}","${notes}"\n`;
    });
    const element = document.createElement("a");
    element.setAttribute("href", "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent));
    element.setAttribute("download", `attendance-summary-${today}.csv`);
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleSaveNote = async () => {
    if (!canManageNotes) return;
    if (!selectedNote) return;
    const employee = allProfileById.get(selectedNote);
    try {
      await upsertAttendanceNote({
        profileId: selectedNote,
        noteDate: todayISO,
        content: newNote,
        notifyIndividual,
        notifyTeamLead,
        createdBy: myProfileId,
      });
      setNotesData({ ...notesData, [selectedNote]: { content: newNote, notifyIndividual, notifyTeamLead } });

      const warnings: string[] = [];
      const noteBody = newNote.trim();
      if (myProfileId && noteBody) {
        const senderName = displayName || "Admin";
        if (notifyIndividual) {
          const thread = await getOrCreateDmThread(myProfileId, selectedNote);
          await sendMessage({
            dmThreadId: thread.id,
            senderId: myProfileId,
            senderName,
            kind: "system",
            body: `📋 Attendance note for you (${todayISO}): ${noteBody}`,
          });
        }
        if (notifyTeamLead && employee) {
          const lead = await resolveTeamLeadOrManager(employee, profiles);
          if (lead && lead.id !== myProfileId) {
            const thread = await getOrCreateDmThread(myProfileId, lead.id);
            await sendMessage({
              dmThreadId: thread.id,
              senderId: myProfileId,
              senderName,
              kind: "system",
              body: `📋 Attendance note about ${employee.display_name || employee.email} (${todayISO}): ${noteBody}`,
            });
          } else if (!lead) {
            warnings.push(`Saved, but no team lead/manager could be found for ${employee.display_name || employee.email} — assign one on the CSR Team board or set their Manager on the user's profile.`);
          }
        }
      }
      setSelectedNote(null);
      if (warnings.length) alert(warnings.join("\n"));
    } catch (error) {
      alert(`Failed to save note: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const ptoFormCreatedAt = profiles.find((p) => p.id === ptoForm.profileId)?.created_at ?? null;
  const ptoFormEligible = !ptoForm.profileId || isEligibleForPto(ptoFormHireDate, ptoFormCreatedAt);
  const ptoFormEligibleOn = ptoEligibleDate(ptoFormHireDate, ptoFormCreatedAt);

  const handleSubmitPtoRequest = async () => {
    if (!ptoForm.profileId || !ptoForm.startDate || !ptoForm.endDate) {
      alert("Please fill in employee, start date, and end date.");
      return;
    }
    if (!isEligibleForPto(ptoFormHireDate, ptoFormCreatedAt)) {
      alert(`${profileName(ptoForm.profileId)} isn't eligible for PTO yet — employees need 1 year of tenure first. Eligible starting ${ptoFormEligibleOn}.`);
      return;
    }
    try {
      const requester = profiles.find((p) => p.id === ptoForm.profileId) ?? null;
      const manager = requester ? await resolveTeamLeadOrManager(requester, profiles) : null;
      await createPtoRequest({
        profileId: ptoForm.profileId,
        ptoType: ptoForm.ptoType,
        startDate: ptoForm.startDate,
        endDate: ptoForm.endDate,
        reason: ptoForm.reason,
        requestedBy: myProfileId,
        managerId: manager?.id ?? null,
      });
      setPtoRequests(await getCompanyPtoRequests());
      setShowPtoForm(false);
      setPtoForm({ profileId: "", ptoType: "vacation", startDate: "", endDate: "", reason: "" });
    } catch (error) {
      alert(`Failed to submit PTO request: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handlePtoStageAction = async (request: PtoRequestRow, stage: PtoStage, decision: "approved" | "rejected") => {
    try {
      await reviewPtoStage(request, stage, decision, myProfileId || "", displayName || "Reviewer");
      setPtoRequests(await getCompanyPtoRequests());
    } catch (error) {
      alert(`Failed to update PTO request: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleSubmitCorrection = async () => {
    if (!correctionForm.profileId || !correctionForm.workDate) {
      alert("Please select an employee and work date.");
      return;
    }
    const existing = entriesByKey.get(`${correctionForm.profileId}|${correctionForm.workDate}`);
    try {
      await createTimecardCorrection({
        profileId: correctionForm.profileId,
        workDate: correctionForm.workDate,
        originalCheckIn: existing?.checkIn || "",
        originalCheckOut: existing?.checkOut || "",
        correctedCheckIn: correctionForm.correctedCheckIn,
        correctedCheckOut: correctionForm.correctedCheckOut,
        originalMealStart: existing?.mealStart || "",
        originalMealEnd: existing?.mealEnd || "",
        correctedMealStart: correctionForm.correctedMealStart,
        correctedMealEnd: correctionForm.correctedMealEnd,
        reason: correctionForm.reason,
        requestedBy: myProfileId,
      });
      setCorrections(await getCompanyTimecardCorrections());
      setCorrectionHistory(await getCompanyTimecardCorrectionHistory());
      setShowCorrectionForm(false);
      setCorrectionForm({ profileId: "", workDate: "", correctedCheckIn: "", correctedCheckOut: "", correctedMealStart: "", correctedMealEnd: "", reason: "" });
    } catch (error) {
      alert(`Failed to submit correction: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const refreshCorrections = async () => {
    setCorrections(await getCompanyTimecardCorrections());
    setCorrectionHistory(await getCompanyTimecardCorrectionHistory());
  };

  const handleApproveCorrection = async () => {
    if (!selectedCorrection) return;
    try {
      await approveTimecardCorrection(
        selectedCorrection,
        correctionTimecardData.checkIn,
        correctionTimecardData.checkOut,
        myProfileId,
        displayName || "HR",
        correctionTimecardData.mealStart,
        correctionTimecardData.mealEnd
      );
      await refreshCorrections();
      setEntries(await getCompanyTimecardEntries(rangeStart, rangeEnd));
      alert(`Correction approved! ${profileName(selectedCorrection.profileId)}'s timecard updated.`);
      setSelectedCorrection(null);
    } catch (error) {
      alert(`Failed to approve correction: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleRejectCorrection = async () => {
    if (!selectedCorrection) return;
    try {
      await rejectTimecardCorrection(selectedCorrection, myProfileId, displayName || "HR");
      await refreshCorrections();
      setSelectedCorrection(null);
    } catch (error) {
      alert(`Failed to reject correction: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> {mod.label}
            </Link>
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
              {sub.title}
            </h1>
            <p className="text-sm text-muted-foreground">{sub.description}</p>
          </div>
        </div>

        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Total Employees</p>
                  <p className="text-2xl font-bold text-white mt-2">{loading ? "…" : totalEmployees}</p>
                </div>
                <Users className="h-8 w-8 text-blue-400 opacity-50" />
              </div>
            </div>
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Present Today</p>
                  <p className="text-2xl font-bold text-green-400 mt-2">{loading ? "…" : presentToday}</p>
                </div>
                <UserCheck className="h-8 w-8 text-green-400 opacity-50" />
              </div>
            </div>
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Absent Today</p>
                  <p className="text-2xl font-bold text-red-400 mt-2">{loading ? "…" : absentToday}</p>
                </div>
                <UserX className="h-8 w-8 text-red-400 opacity-50" />
              </div>
            </div>
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Late Today</p>
                  <p className="text-2xl font-bold text-yellow-400 mt-2">{loading ? "…" : lateToday}</p>
                </div>
                <Clock className="h-8 w-8 text-yellow-400 opacity-50" />
              </div>
            </div>
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase">PTO Pending</p>
                  <p className="text-2xl font-bold text-purple-400 mt-2">{loading ? "…" : ptoPendingApproval}</p>
                </div>
                <Calendar className="h-8 w-8 text-purple-400 opacity-50" />
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 border-b border-white/10 overflow-x-auto">
            {[
              { id: "daily-attendance", label: "Daily Attendance", Icon: Clock },
              { id: "pto-management", label: "PTO Management", Icon: Calendar },
              { id: "corrections", label: "Corrections", Icon: FileText },
              { id: "warnings", label: "Warnings", Icon: AlertTriangle },
            ].map(tab => {
              const Icon = tab.Icon;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`px-4 py-2 border-b-2 transition whitespace-nowrap flex items-center gap-2 ${activeTab === tab.id ? "border-blue-500 text-blue-300" : "border-transparent text-slate-400 hover:text-slate-300"}`}>
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Tab Content */}
          {activeTab === "daily-attendance" && (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 bg-slate-900/50 border border-white/10 rounded-lg p-4 backdrop-blur">
                  <h2 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-orange-400" />
                    Attendance Alerts
                  </h2>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <button
                      onClick={() => { setSelectedAlertType("missing-clockin"); setAlertModalOpen(true); }}
                      className="bg-gradient-to-br from-red-500/15 to-red-600/5 border border-red-500/40 rounded p-2 hover:border-red-500/60 hover:bg-red-500/20 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-red-500/20 rounded">
                          <AlertCircle className="h-3 w-3 text-red-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-red-300 truncate">Missing Clock In</p>
                          <div className="flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500"></span>
                            <span className="text-xs font-bold text-red-300">{dailyRecords.filter(r => r.checkIn === "—" && !r.isOffDay).length}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={() => { setSelectedAlertType("missing-clockout"); setAlertModalOpen(true); }}
                      className="bg-gradient-to-br from-yellow-500/15 to-yellow-600/5 border border-yellow-500/40 rounded p-2 hover:border-yellow-500/60 hover:bg-yellow-500/20 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-yellow-500/20 rounded">
                          <AlertCircle className="h-3 w-3 text-yellow-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-yellow-300 truncate">Missing Clock Out</p>
                          <div className="flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-500"></span>
                            <span className="text-xs font-bold text-yellow-300">{dailyRecords.filter(r => r.checkOut === "—" && r.checkIn !== "—").length}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={() => { setSelectedAlertType("late-arrival"); setAlertModalOpen(true); }}
                      className="bg-gradient-to-br from-orange-500/15 to-orange-600/5 border border-orange-500/40 rounded p-2 hover:border-orange-500/60 hover:bg-orange-500/20 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-orange-500/20 rounded">
                          <AlertCircle className="h-3 w-3 text-orange-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-orange-300 truncate">Late Arrival</p>
                          <div className="flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-500"></span>
                            <span className="text-xs font-bold text-orange-300">{dailyRecords.filter(r => r.alerts.some(a => a.includes("Late"))).length}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
                <button onClick={handleDownloadSummary} className="group relative px-4 py-3 bg-gradient-to-br from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white rounded-lg transition shadow-lg hover:shadow-blue-500/50 flex flex-col items-center justify-center gap-1 h-fit min-w-fit">
                  <Download className="h-5 w-5 group-hover:scale-110 transition transform" />
                  <div className="text-xs font-semibold">Download</div>
                </button>
              </div>

              {/* Filters and Search for Daily */}
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-2">Search Employee</label>
                    <input
                      type="text"
                      placeholder="Enter employee name..."
                      value={searchEmployee}
                      onChange={(e) => setSearchEmployee(e.target.value)}
                      className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-2">Filter by Department</label>
                    <select value={filterDepartment} onChange={(e) => setFilterDepartment(e.target.value)} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none">
                      <option value="all">All Departments</option>
                      {departments.map(dept => (
                        <option key={dept} value={dept}>{dept}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-2">Filter by Location</label>
                    <select value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none">
                      <option value="all">All Locations</option>
                      {locations.map(loc => (
                        <option key={loc} value={loc}>{loc}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Daily Attendance Table */}
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
                <h2 className="text-lg font-bold text-white mb-4">Daily Attendance Tracker — {todayISO}</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Location</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Department</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Check In</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Check Out</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Alerts</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Loading attendance…</td></tr>
                    ) : filteredAndSortedData.length === 0 ? (
                      <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">No employees match this filter.</td></tr>
                    ) : filteredAndSortedData.map((record) => (
                      <tr key={record.profileId} className="border-b border-white/5 hover:bg-white/5 transition">
                        <td className="px-3 py-3 text-white font-medium">
                          <a href={`/employee/${record.profileId}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer">
                            {record.name}
                          </a>
                        </td>
                        <td className="px-3 py-3 text-slate-300">{record.location || "—"}</td>
                        <td className="px-3 py-3 text-slate-300">{record.department || "—"}</td>
                        <td className="px-3 py-3 text-slate-300">{record.checkIn}</td>
                        <td className="px-3 py-3 text-slate-300">{record.checkOut}</td>
                        <td className="px-3 py-3">
                          {record.alerts.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {record.alerts.map((alert, i) => (
                                <span key={i} className={`inline-block px-2 py-1 rounded text-xs font-semibold border ${getAlertColor(alert)}`}>
                                  {alert}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-green-400 text-xs font-semibold">✓ OK</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {canManageNotes ? (
                            <button type="button" onClick={() => { setSelectedNote(record.profileId); setNewNote(notesData[record.profileId]?.content || ""); setNotifyIndividual(notesData[record.profileId]?.notifyIndividual || false); setNotifyTeamLead(notesData[record.profileId]?.notifyTeamLead || false); }} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 transition">
                              <MessageSquare className="h-4 w-4" />
                              <span className="text-xs">{notesData[record.profileId] ? "Edit" : "Add"}</span>
                            </button>
                          ) : (
                            <span className="text-slate-500 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Summary View Toggle */}
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4 mb-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-300">View:</span>
                    <button
                      onClick={() => setSummaryView("weekly")}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${summaryView === "weekly" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
                    >
                      Weekly
                    </button>
                    <button
                      onClick={() => setSummaryView("monthly")}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${summaryView === "monthly" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
                    >
                      Monthly
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 uppercase">Department</span>
                    <select
                      value={summaryDepartmentFilter}
                      onChange={(e) => setSummaryDepartmentFilter(e.target.value)}
                      className="bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none"
                    >
                      <option value="all">All Departments</option>
                      {departments.map((dept) => (
                        <option key={dept} value={dept}>{dept}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Weekly Attendance */}
              {summaryView === "weekly" && (
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
                <h2 className="text-lg font-bold text-white mb-4">Weekly Attendance Summary</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Mon</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Tue</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Wed</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Thu</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Fri</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Total Days</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Attendance %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeklySummary.map((row) => (
                      <tr key={row.profileId} className="border-b border-white/5 hover:bg-white/5 transition">
                        <td className="px-3 py-3 text-white font-medium">
                          <a href={`/employee/${row.profileId}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer">
                            {row.name}
                          </a>
                        </td>
                        {row.cells.map((cell, i) => (
                          <td key={i} className="px-3 py-3 text-center text-xs">
                            {cell === "off" ? (
                              <span className="inline-block px-2 py-1 rounded bg-slate-700/50 text-slate-400">OFF</span>
                            ) : cell === "future" ? (
                              <span className="text-slate-600">—</span>
                            ) : cell === "present" ? (
                              <span className="inline-block px-2 py-1 rounded bg-green-500/20 text-green-300">✓</span>
                            ) : (
                              <span className="inline-block px-2 py-1 rounded bg-red-500/20 text-red-300">✗</span>
                            )}
                          </td>
                        ))}
                        <td className="px-3 py-3 text-center text-white font-semibold">{row.presentCount} / {row.workingDays}</td>
                        <td className="px-3 py-3 text-center text-white font-semibold">{row.pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}

              {/* Monthly Attendance */}
              {summaryView === "monthly" && (
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
                <h2 className="text-lg font-bold text-white mb-4">Monthly Attendance Summary (Month to Date)</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Total Days</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Present</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Absent</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Late</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Attendance %</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlySummary.map((row) => (
                      <tr key={row.profileId} className="border-b border-white/5 hover:bg-white/5 transition">
                        <td className="px-3 py-3 text-white font-medium">
                          <a href={`/employee/${row.profileId}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer">
                            {row.name}
                          </a>
                        </td>
                        <td className="px-3 py-3 text-center text-slate-300">{row.workingDays}</td>
                        <td className="px-3 py-3 text-center text-green-300 font-semibold">{row.present}</td>
                        <td className="px-3 py-3 text-center text-red-300 font-semibold">{row.absent}</td>
                        <td className="px-3 py-3 text-center text-yellow-300 font-semibold">{row.late}</td>
                        <td className="px-3 py-3 text-center text-white font-semibold">{row.pct}%</td>
                        <td className="px-3 py-3">
                          <span className={`inline-block px-2 py-1 rounded text-xs font-semibold border ${row.status === "Good" ? "bg-green-500/20 text-green-300 border-green-500/30" : row.status === "Warning" ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" : "bg-red-500/20 text-red-300 border-red-500/30"}`}>{row.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
            </>
          )}

          {activeTab === "pto-management" && (
            <div className="space-y-6">
              <div className="flex justify-end">
                <button onClick={() => setShowPtoForm(true)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition">
                  + New PTO Request
                </button>
              </div>

              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
                <h2 className="text-lg font-bold text-white mb-4">PTO Requests</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Type</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Dates</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Days</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Status</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
                    ) : ptoRequests.filter(r => r.status === "pending").length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">No pending PTO requests.</td></tr>
                    ) : ptoRequests.filter(r => r.status === "pending").map((request) => (
                      <tr key={request.id} className="border-b border-white/5 hover:bg-white/5 transition">
                        <td className="px-3 py-3 text-white font-medium">{profileName(request.profileId)}</td>
                        <td className="px-3 py-3 text-slate-300">{PTO_TYPE_LABELS[request.ptoType]}</td>
                        <td className="px-3 py-3 text-slate-300">{request.startDate} to {request.endDate}</td>
                        <td className="px-3 py-3 text-center text-slate-300">{Math.round(request.hoursRequested / 8)}</td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-1">
                            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${
                              request.managerStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30"
                              : request.managerStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30"
                              : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                            }`}>
                              Manager: {request.managerStatus.charAt(0).toUpperCase() + request.managerStatus.slice(1)}
                              {request.managerReviewedBy ? ` — ${profileName(request.managerReviewedBy)}` : ""}
                            </span>
                            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${
                              request.hrStatus === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30"
                              : request.hrStatus === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30"
                              : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                            }`}>
                              HR: {request.hrStatus.charAt(0).toUpperCase() + request.hrStatus.slice(1)}
                              {request.hrReviewedBy ? ` — ${profileName(request.hrReviewedBy)}` : ""}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-1.5">
                            {request.managerStatus === "pending" && canReviewPtoStage(request, "manager", myProfileId, role) && (
                              <div className="flex gap-1">
                                <span className="text-[10px] text-slate-500 self-center">Mgr:</span>
                                <button type="button" title="Approve as manager" onClick={() => handlePtoStageAction(request, "manager", "approved")} className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs transition flex items-center gap-1">
                                  <CheckCircle className="h-3 w-3" />
                                </button>
                                <button type="button" title="Reject as manager" onClick={() => handlePtoStageAction(request, "manager", "rejected")} className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs transition flex items-center gap-1">
                                  <XCircle className="h-3 w-3" />
                                </button>
                              </div>
                            )}
                            {request.hrStatus === "pending" && canReviewPtoStage(request, "hr", myProfileId, role) && (
                              <div className="flex gap-1">
                                <span className="text-[10px] text-slate-500 self-center">HR:</span>
                                <button type="button" title="Approve as HR" onClick={() => handlePtoStageAction(request, "hr", "approved")} className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs transition flex items-center gap-1">
                                  <CheckCircle className="h-3 w-3" />
                                </button>
                                <button type="button" title="Reject as HR" onClick={() => handlePtoStageAction(request, "hr", "rejected")} className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs transition flex items-center gap-1">
                                  <XCircle className="h-3 w-3" />
                                </button>
                              </div>
                            )}
                            {!(request.managerStatus === "pending" && canReviewPtoStage(request, "manager", myProfileId, role)) &&
                             !(request.hrStatus === "pending" && canReviewPtoStage(request, "hr", myProfileId, role)) && (
                              <span className="text-xs text-slate-500">Awaiting other approver</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* PTO History */}
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
                <h2 className="text-lg font-bold text-white mb-4">PTO History</h2>
                <div className="space-y-3">
                  {ptoRequests.filter(r => r.status !== "pending").length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-slate-400 text-sm">No PTO history yet</p>
                    </div>
                  ) : ptoRequests.filter(r => r.status !== "pending").map((request) => (
                    <div key={request.id} className="bg-slate-800/50 border border-white/10 rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-white">{profileName(request.profileId)} - {PTO_TYPE_LABELS[request.ptoType]}</p>
                          <p className="text-xs text-slate-400 mt-1">{request.startDate} to {request.endDate}</p>
                          <p className="text-xs text-slate-500 mt-2">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold mr-2 ${
                              request.status === "approved" ? "bg-green-500/20 text-green-300" : request.status === "denied" ? "bg-red-500/20 text-red-300" : "bg-slate-500/20 text-slate-300"
                            }`}>
                              {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                            </span>
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            Manager: {request.managerStatus}{request.managerReviewedBy ? ` by ${profileName(request.managerReviewedBy)}` : ""}{request.managerReviewedAt ? ` on ${request.managerReviewedAt.slice(0, 10)}` : ""}
                          </p>
                          <p className="text-xs text-slate-500">
                            HR: {request.hrStatus}{request.hrReviewedBy ? ` by ${profileName(request.hrReviewedBy)}` : ""}{request.hrReviewedAt ? ` on ${request.hrReviewedAt.slice(0, 10)}` : ""}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === "corrections" && (
            <div className="space-y-6">
              <div className="flex justify-end">
                <button onClick={() => setShowCorrectionForm(true)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition">
                  + New Correction Request
                </button>
              </div>

              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
                <h2 className="text-lg font-bold text-white mb-4">Attendance Corrections</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Work Date</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Original Time</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Reason</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Status</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
                    ) : corrections.length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">No correction requests yet.</td></tr>
                    ) : corrections.map((correction) => (
                      <tr key={correction.id} className="border-b border-white/5 hover:bg-white/5 transition">
                        <td className="px-3 py-3 text-white font-medium">
                          <a href={`/employee/${correction.profileId}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer">
                            {profileName(correction.profileId)}
                          </a>
                        </td>
                        <td className="px-3 py-3 text-slate-300">{correction.workDate}</td>
                        <td className="px-3 py-3 text-slate-300">{correction.originalCheckIn || "—"} → {correction.originalCheckOut || "—"}</td>
                        <td className="px-3 py-3 text-slate-300">{correction.reason || "—"}</td>
                        <td className="px-3 py-3">
                          <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${correction.status === "pending" ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30" : correction.status === "approved" ? "bg-green-500/20 text-green-300 border border-green-500/30" : "bg-red-500/20 text-red-300 border border-red-500/30"}`}>
                            {correction.status.charAt(0).toUpperCase() + correction.status.slice(1)}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          {correction.status === "pending" ? (
                            <button onClick={() => { setSelectedCorrection(correction); setCorrectionTimecardData({ checkIn: correction.correctedCheckIn || correction.originalCheckIn, checkOut: correction.correctedCheckOut || correction.originalCheckOut, mealStart: correction.correctedMealStart || correction.originalMealStart, mealEnd: correction.correctedMealEnd || correction.originalMealEnd }); }} className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs transition flex items-center gap-1">
                              View Timecard
                            </button>
                          ) : (
                            <span className="text-slate-400 text-xs">{correction.status === "approved" ? "Approved" : "Rejected"}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Correction History */}
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
                <h2 className="text-lg font-bold text-white mb-4">Correction History</h2>
                <div className="space-y-3">
                  {correctionHistory.length > 0 ? (
                    correctionHistory.map((history) => {
                      const relatedCorrection = corrections.find(c => c.id === history.correctionId);
                      return (
                        <div key={history.id} className="bg-slate-800/50 border border-white/10 rounded-lg p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="text-sm font-semibold text-white capitalize">{history.action}</p>
                              <p className="text-xs text-slate-400 mt-1">Changed by <span className="text-slate-300">{profileName(history.changedBy)}</span> on {new Date(history.createdAt).toLocaleString()}</p>
                              {relatedCorrection && (
                                <p className="text-xs text-slate-400 mt-2">
                                  Employee: <span className="text-slate-300 font-semibold">{profileName(relatedCorrection.profileId)}</span> |
                                  Date: <span className="text-slate-300">{relatedCorrection.workDate}</span> |
                                  Original: <span className="text-slate-300">{relatedCorrection.originalCheckIn || "—"} → {relatedCorrection.originalCheckOut || "—"}</span> →
                                  Corrected: <span className="text-slate-300 font-semibold">{relatedCorrection.correctedCheckIn || "—"} → {relatedCorrection.correctedCheckOut || "—"}</span>
                                </p>
                              )}
                              {history.previousStatus && (
                                <p className="text-xs text-slate-500 mt-2">
                                  Status: <span className="font-semibold text-slate-300">{history.previousStatus}</span> →
                                  <span className="font-semibold text-slate-300"> {history.newStatus}</span>
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-slate-400 text-sm">No correction history yet</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === "warnings" && (
            <div className="space-y-6">
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h2 className="text-sm font-bold text-white flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-yellow-400" />
                      Tardy Employees — Month to Date
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">Issue a warning for repeated tardiness — it goes to the same review queue as HR's Warnings &amp; Mistakes tab.</p>
                  </div>
                  <input
                    type="text"
                    placeholder="Search employee..."
                    value={warnSearch}
                    onChange={(e) => setWarnSearch(e.target.value)}
                    className="bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none w-56"
                  />
                </div>
              </div>

              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Late (MTD)</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 uppercase">Attendance %</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Status</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
                    ) : warnEmployees.length === 0 ? (
                      <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">No employees match this search.</td></tr>
                    ) : warnEmployees.map((row) => (
                      <tr key={row.profileId} className="border-b border-white/5 hover:bg-white/5 transition">
                        <td className="px-3 py-3 text-white font-medium">
                          <a href={`/employee/${row.profileId}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer">
                            {row.name}
                          </a>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${row.late === 0 ? "text-slate-500" : row.late <= 2 ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30" : "bg-red-500/20 text-red-300 border border-red-500/30"}`}>
                            {row.late}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center text-white font-semibold">{row.pct}%</td>
                        <td className="px-3 py-3">
                          <span className={`inline-block px-2 py-1 rounded text-xs font-semibold border ${row.status === "Good" ? "bg-green-500/20 text-green-300 border-green-500/30" : row.status === "Warning" ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" : "bg-red-500/20 text-red-300 border-red-500/30"}`}>{row.status}</span>
                        </td>
                        <td className="px-3 py-3">
                          {canWarn ? (
                            <button
                              type="button"
                              onClick={() => { setWarnTarget({ profileId: row.profileId, name: row.name }); setWarnText(row.late > 0 ? `Repeated tardiness — ${row.late} late arrival${row.late === 1 ? "" : "s"} this month.` : ""); }}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 transition"
                            >
                              <AlertTriangle className="h-3.5 w-3.5" />
                              <span className="text-xs">Warn</span>
                            </button>
                          ) : (
                            <span className="text-slate-500 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Recent Warnings & Mistakes — same employee_conduct_notes table HR reviews */}
              <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6 overflow-x-auto">
                <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-400" /> Recent Warnings &amp; Mistakes
                </h2>
                {conductNotes.length === 0 ? (
                  <p className="text-sm text-slate-400 py-4 text-center">No warnings or mistakes on file yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Employee</th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Type</th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Note</th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Submitted</th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {conductNotes.slice(0, 15).map((n) => (
                        <tr key={n.id} className="border-b border-white/5 hover:bg-white/5 transition">
                          <td className="px-3 py-3 text-white font-medium">
                            <a href={`/employee/${n.agentProfileId}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer">
                              {profileName(n.agentProfileId)}
                            </a>
                          </td>
                          <td className="px-3 py-3">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${n.type === "warning" ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30" : "bg-orange-500/20 text-orange-300 border border-orange-500/30"}`}>
                              {n.type === "warning" ? "Warning" : "Mistake"}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-slate-300 max-w-xs truncate" title={n.note}>{n.note}</td>
                          <td className="px-3 py-3 text-slate-400 text-xs">{new Date(n.createdAt).toLocaleString()}</td>
                          <td className="px-3 py-3">
                            <span className={`inline-block px-2 py-1 rounded text-xs font-semibold border ${n.status === "approved" ? "bg-green-500/20 text-green-300 border-green-500/30" : n.status === "rejected" ? "bg-red-500/20 text-red-300 border-red-500/30" : "bg-slate-500/20 text-slate-300 border-slate-500/30"}`}>
                              {n.status === "approved" ? "Approved" : n.status === "rejected" ? "Rejected" : n.status === "manager_approved" ? "Awaiting HR" : "Pending"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Warning Modal */}
        {warnTarget && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-md w-full mx-4">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-yellow-400" /> Issue Warning
                  </h3>
                  <p className="text-sm text-slate-400">{warnTarget.name}</p>
                </div>
                <button type="button" onClick={() => { setWarnTarget(null); setWarnText(""); }} className="text-slate-400 hover:text-white transition p-1">✕</button>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-semibold text-slate-300 mb-2">Warning Note</label>
                <textarea value={warnText} onChange={(e) => setWarnText(e.target.value)} placeholder="Describe the tardiness / conduct issue..." rows={4} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-3 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none resize-none" />
              </div>
              <p className="text-xs text-slate-500 mb-4">
                This always goes to the HR Warnings &amp; Mistakes dashboard for review before it's issued — the employee is only notified once it's approved there.
              </p>
              <div className="flex gap-3">
                <button type="button" onClick={handleSubmitWarning} disabled={warnSaving} className="flex-1 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 text-white rounded-lg transition font-semibold text-sm">
                  {warnSaving ? "Submitting…" : "Submit for Review"}
                </button>
                <button type="button" onClick={() => { setWarnTarget(null); setWarnText(""); }} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Notes Modal */}
        {selectedNote && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-md w-full mx-4">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-white">{profileName(selectedNote)}</h3>
                  <p className="text-sm text-slate-400">{todayISO}</p>
                </div>
                <button onClick={() => setSelectedNote(null)} className="text-slate-400 hover:text-white transition p-1">✕</button>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-semibold text-slate-300 mb-2">Add Note</label>
                <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Add note for this employee..." className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-3 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none resize-none" rows={4} />
              </div>
              <div className="space-y-3 mb-6">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={notifyIndividual} onChange={(e) => setNotifyIndividual(e.target.checked)} className="rounded border border-white/20 w-4 h-4 accent-blue-500" />
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-blue-400" />
                    <span className="text-sm text-slate-300">Notify Individual</span>
                  </div>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={notifyTeamLead} onChange={(e) => setNotifyTeamLead(e.target.checked)} className="rounded border border-white/20 w-4 h-4 accent-blue-500" />
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-orange-400" />
                    <span className="text-sm text-slate-300">Notify Team Lead</span>
                  </div>
                </label>
              </div>
              <div className="flex gap-3">
                <button onClick={handleSaveNote} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-semibold text-sm">Save Note</button>
                <button onClick={() => setSelectedNote(null)} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm">Close</button>
              </div>
            </div>
          </div>
        )}

        {/* New PTO Request Modal */}
        {showPtoForm && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-md w-full mx-4">
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-lg font-bold text-white">New PTO Request</h3>
                <button onClick={() => setShowPtoForm(false)} className="text-slate-400 hover:text-white transition p-1">✕</button>
              </div>
              <div className="space-y-3 mb-6">
                <div>
                  <label className="block text-xs text-slate-400 uppercase mb-1">Employee</label>
                  <select value={ptoForm.profileId} onChange={(e) => setPtoForm({ ...ptoForm, profileId: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none">
                    <option value="">Select employee</option>
                    {visibleProfiles.map((p) => (
                      <option key={p.id} value={p.id}>{p.display_name || p.email}</option>
                    ))}
                  </select>
                  {ptoForm.profileId && !ptoFormEligible && (
                    <p className="text-xs text-amber-300 mt-1">
                      Not yet eligible for PTO — needs 1 year of tenure first (eligible starting {ptoFormEligibleOn}).
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-slate-400 uppercase mb-1">Type</label>
                  <select value={ptoForm.ptoType} onChange={(e) => setPtoForm({ ...ptoForm, ptoType: e.target.value as PtoType })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none">
                    {(Object.keys(PTO_TYPE_LABELS) as PtoType[]).map((t) => (
                      <option key={t} value={t}>{PTO_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-1">Start Date</label>
                    <input type="date" value={ptoForm.startDate} onChange={(e) => setPtoForm({ ...ptoForm, startDate: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-1">End Date</label>
                    <input type="date" value={ptoForm.endDate} onChange={(e) => setPtoForm({ ...ptoForm, endDate: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 uppercase mb-1">Reason</label>
                  <textarea value={ptoForm.reason} onChange={(e) => setPtoForm({ ...ptoForm, reason: e.target.value })} rows={3} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none resize-none" />
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleSubmitPtoRequest}
                  disabled={!ptoFormEligible}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition font-semibold text-sm"
                >
                  Submit
                </button>
                <button onClick={() => setShowPtoForm(false)} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* New Correction Request Modal */}
        {showCorrectionForm && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-md w-full mx-4">
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-lg font-bold text-white">New Correction Request</h3>
                <button onClick={() => setShowCorrectionForm(false)} className="text-slate-400 hover:text-white transition p-1">✕</button>
              </div>
              <div className="space-y-3 mb-6">
                <div>
                  <label className="block text-xs text-slate-400 uppercase mb-1">Employee</label>
                  <select value={correctionForm.profileId} onChange={(e) => setCorrectionForm({ ...correctionForm, profileId: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none">
                    <option value="">Select employee</option>
                    {visibleProfiles.map((p) => (
                      <option key={p.id} value={p.id}>{p.display_name || p.email}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 uppercase mb-1">Work Date</label>
                  <input type="date" value={correctionForm.workDate} onChange={(e) => setCorrectionForm({ ...correctionForm, workDate: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                  {correctionForm.profileId && correctionForm.workDate && (
                    <p className="text-xs text-slate-500 mt-1">
                      {(() => {
                        const existing = entriesByKey.get(`${correctionForm.profileId}|${correctionForm.workDate}`);
                        return existing
                          ? `Current record: ${existing.checkIn || "—"} → ${existing.checkOut || "—"} (meal: ${existing.mealStart || "—"} → ${existing.mealEnd || "—"})`
                          : "No existing record found for this date.";
                      })()}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-1">Corrected Check In</label>
                    <input type="time" step="1" title="Corrected Check In" value={correctionForm.correctedCheckIn} onChange={(e) => setCorrectionForm({ ...correctionForm, correctedCheckIn: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-1">Corrected Check Out</label>
                    <input type="time" step="1" title="Corrected Check Out" value={correctionForm.correctedCheckOut} onChange={(e) => setCorrectionForm({ ...correctionForm, correctedCheckOut: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-1">Corrected Meal Start</label>
                    <input type="time" step="1" title="Corrected Meal Start" value={correctionForm.correctedMealStart} onChange={(e) => setCorrectionForm({ ...correctionForm, correctedMealStart: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-1">Corrected Meal End</label>
                    <input type="time" step="1" title="Corrected Meal End" value={correctionForm.correctedMealEnd} onChange={(e) => setCorrectionForm({ ...correctionForm, correctedMealEnd: e.target.value })} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 uppercase mb-1">Reason</label>
                  <textarea value={correctionForm.reason} onChange={(e) => setCorrectionForm({ ...correctionForm, reason: e.target.value })} rows={3} className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none resize-none" />
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={handleSubmitCorrection} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-semibold text-sm">Submit</button>
                <button onClick={() => setShowCorrectionForm(false)} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Timecard Correction Modal */}
        {selectedCorrection && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-white">Timecard Correction</h2>
                  <p className="text-sm text-slate-400 mt-1">Employee: <a href={`/employee/${selectedCorrection.profileId}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">{profileName(selectedCorrection.profileId)}</a></p>
                  <p className="text-sm text-slate-400">Work Date: {selectedCorrection.workDate}</p>
                </div>
                <button onClick={() => setSelectedCorrection(null)} className="text-slate-400 hover:text-white transition p-1">✕</button>
              </div>

              {/* Timecard Details */}
              <div className="bg-slate-800/50 border border-white/10 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-bold text-white mb-4">Clock Times</h3>
                <p className="text-xs text-slate-400 mb-3">Original: {selectedCorrection.originalCheckIn || "—"} → {selectedCorrection.originalCheckOut || "—"}</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-2">Check In</label>
                    <input type="time" step="1" title="Check In" value={correctionTimecardData.checkIn} onChange={(e) => setCorrectionTimecardData({ ...correctionTimecardData, checkIn: e.target.value })} className="w-full bg-slate-700/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-2">Check Out</label>
                    <input type="time" step="1" title="Check Out" value={correctionTimecardData.checkOut} onChange={(e) => setCorrectionTimecardData({ ...correctionTimecardData, checkOut: e.target.value })} className="w-full bg-slate-700/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                  </div>
                </div>
                {(selectedCorrection.correctedMealStart || selectedCorrection.correctedMealEnd || selectedCorrection.originalMealStart || selectedCorrection.originalMealEnd) && (
                  <>
                    <p className="text-xs text-slate-400 mt-4 mb-3">Original Meal: {selectedCorrection.originalMealStart || "—"} → {selectedCorrection.originalMealEnd || "—"}</p>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="block text-xs text-slate-400 uppercase mb-2">Meal Start</label>
                        <input type="time" step="1" title="Meal Start" value={correctionTimecardData.mealStart} onChange={(e) => setCorrectionTimecardData({ ...correctionTimecardData, mealStart: e.target.value })} className="w-full bg-slate-700/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 uppercase mb-2">Meal End</label>
                        <input type="time" step="1" title="Meal End" value={correctionTimecardData.mealEnd} onChange={(e) => setCorrectionTimecardData({ ...correctionTimecardData, mealEnd: e.target.value })} className="w-full bg-slate-700/50 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-blue-500 focus:outline-none" />
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Correction Details */}
              <div className="bg-slate-800/50 border border-white/10 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-bold text-white mb-4">Correction Details</h3>
                <div className="space-y-2">
                  <p className="text-sm text-slate-300"><span className="text-slate-400">Reason:</span> {selectedCorrection.reason || "—"}</p>
                  <p className="text-sm text-slate-300"><span className="text-slate-400">Requested:</span> {new Date(selectedCorrection.createdAt).toLocaleString()}</p>
                  <p className="text-sm text-slate-300"><span className="text-slate-400">Status:</span> <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-yellow-500/20 text-yellow-300">{selectedCorrection.status}</span></p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid gap-3 mb-6 md:grid-cols-2">
                <button onClick={handleApproveCorrection} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition font-semibold text-sm flex items-center justify-center gap-2">
                  <CheckCircle className="h-4 w-4" />
                  Save & Approve
                </button>
                <button onClick={handleRejectCorrection} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition font-semibold text-sm flex items-center justify-center gap-2">
                  <XCircle className="h-4 w-4" />
                  Reject
                </button>
              </div>

              {/* Correction History for this item */}
              <div className="border-t border-white/10 pt-4">
                <h3 className="text-sm font-bold text-white mb-3">This Correction's History</h3>
                <div className="space-y-2">
                  {correctionHistory.filter(h => h.correctionId === selectedCorrection.id).length > 0 ? (
                    correctionHistory.filter(h => h.correctionId === selectedCorrection.id).map((history) => (
                      <div key={history.id} className="bg-slate-700/30 border border-white/5 rounded p-3 text-xs">
                        <p className="text-slate-300 capitalize">{history.action} by <span className="font-semibold text-white">{profileName(history.changedBy)}</span></p>
                        <p className="text-slate-500">{new Date(history.createdAt).toLocaleString()}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-slate-500 text-xs">No history yet</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Alert Details Modal */}
        {alertModalOpen && selectedAlertType && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setAlertModalOpen(false)}>
            <div className="bg-slate-900 border border-white/10 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                <h2 className="text-lg font-bold text-white">
                  {selectedAlertType === "missing-clockin" && "Missing Clock In"}
                  {selectedAlertType === "missing-clockout" && "Missing Clock Out"}
                  {selectedAlertType === "late-arrival" && "Late Arrival"}
                </h2>
                <button
                  onClick={() => setAlertModalOpen(false)}
                  className="p-1 hover:bg-white/10 rounded transition"
                >
                  <svg className="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Modal Content */}
              <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-3">
                  {selectedAlertType === "missing-clockin" && dailyRecords.filter(r => r.checkIn === "—" && !r.isOffDay).map(record => (
                    <div key={record.profileId} className="bg-slate-800/50 border border-red-500/30 rounded-lg p-4 hover:bg-slate-800/70 transition">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-white font-semibold">{record.name}</p>
                          <p className="text-xs text-slate-400 mt-1">{record.department || "—"} • {record.location || "—"}</p>
                          <p className="text-xs text-slate-500 mt-2">Manager: {record.manager || "—"}</p>
                        </div>
                        <div className="text-right">
                          <span className="inline-block px-3 py-1 bg-red-500/20 text-red-300 text-xs font-semibold rounded border border-red-500/40">
                            No Clock In
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}

                  {selectedAlertType === "missing-clockout" && dailyRecords.filter(r => r.checkOut === "—" && r.checkIn !== "—").map(record => (
                    <div key={record.profileId} className="bg-slate-800/50 border border-yellow-500/30 rounded-lg p-4 hover:bg-slate-800/70 transition">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-white font-semibold">{record.name}</p>
                          <p className="text-xs text-slate-400 mt-1">{record.department || "—"} • {record.location || "—"}</p>
                          <p className="text-xs text-slate-400 mt-2">Clock In: <span className="font-mono font-semibold">{record.checkIn}</span></p>
                          <p className="text-xs text-slate-500 mt-1">Manager: {record.manager || "—"}</p>
                        </div>
                        <div className="text-right">
                          <span className="inline-block px-3 py-1 bg-yellow-500/20 text-yellow-300 text-xs font-semibold rounded border border-yellow-500/40">
                            No Clock Out
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}

                  {selectedAlertType === "late-arrival" && dailyRecords.filter(r => r.alerts.some(a => a.includes("Late"))).map(record => (
                    <div key={record.profileId} className="bg-slate-800/50 border border-orange-500/30 rounded-lg p-4 hover:bg-slate-800/70 transition">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-white font-semibold">{record.name}</p>
                          <p className="text-xs text-slate-400 mt-1">{record.department || "—"} • {record.location || "—"}</p>
                          <p className="text-xs text-slate-400 mt-2">Check In: <span className="font-mono font-semibold">{record.checkIn}</span></p>
                          <p className="text-xs text-slate-500 mt-1">Manager: {record.manager || "—"}</p>
                        </div>
                        <div className="text-right">
                          <span className="inline-block px-3 py-1 bg-orange-500/20 text-orange-300 text-xs font-semibold rounded border border-orange-500/40">
                            Late
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="border-t border-white/10 px-6 py-4">
                <button
                  onClick={() => setAlertModalOpen(false)}
                  className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
