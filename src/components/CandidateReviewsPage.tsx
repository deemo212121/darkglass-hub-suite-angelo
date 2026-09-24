/**
 * HR module -> Candidate Reviews. The flip side of the Hiring tab's
 * "Forward Candidate" action (ReportHRDaily.tsx's handleForwardCv) — that
 * sends a candidate's details + CV to one or more managers via the
 * internal messenger AND logs it to hr_candidate_cv_forwards
 * (recipient_id, candidate_id, ...). This page is where a recipient (most
 * often a Branch Manager, who may have no other reason to be in the HR
 * module at all) comes back to actually act on it: see every candidate
 * that's been forwarded specifically to THEM, and fill in the Interviewer
 * Note field HR's own Hiring table reads right back (interviewer_note on
 * hr_candidates, same column, same updateCandidateInterviewerNote write).
 *
 * Deliberately self-scoping rather than gated by role: it only ever shows
 * rows where the signed-in person is the recipient_id on a real forward,
 * so it's safe to leave open to everyone by default (nothing to see until
 * HR actually forwards you something) rather than needing a hardcoded
 * role list — Accessibility Management can still narrow it if ever wanted.
 *
 * Dispatched from m.$module.$submodule.tsx for custom === "candidate-reviews".
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ClipboardList, Loader2, RefreshCw, FileText, Check, Calendar as CalendarIcon, List as ListIcon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getMyProfileId, getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { InterviewCalendarTab, type InterviewCalendarCandidate } from "@/components/InterviewCalendarTab";
import {
  getCvForwardsForRecipient,
  getCandidateCvUrlForForwarding,
  updateCandidateInterviewerNote,
  logCandidateFieldEdit,
  type Candidate,
  type CandidateStatus,
} from "@/lib/supabase/hrCandidates";

// Same labels/colors as ReportHRDaily.tsx's own CANDIDATE_STATUS_LABEL/
// CANDIDATE_STATUS_COLOR — duplicated locally rather than exported from
// that (28,000+ line) file for one small lookup table.
const STATUS_LABEL: Record<CandidateStatus, string> = {
  applied: "Applied",
  attempt: "Attempt",
  phone_screening: "Phone Screening",
  interviewing: "Interviewing",
  selected: "Selected",
  training: "Training",
  hired: "Hired",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  cancelled: "Cancelled",
};
const STATUS_COLOR: Record<CandidateStatus, string> = {
  applied: "bg-blue-500/20 text-blue-300",
  attempt: "bg-orange-500/20 text-orange-300",
  phone_screening: "bg-indigo-500/20 text-indigo-300",
  interviewing: "bg-yellow-500/20 text-yellow-300",
  selected: "bg-purple-500/20 text-purple-300",
  training: "bg-cyan-500/20 text-cyan-300",
  hired: "bg-green-500/20 text-green-300",
  rejected: "bg-red-500/20 text-red-300",
  withdrawn: "bg-slate-500/20 text-slate-300",
  cancelled: "bg-slate-500/20 text-slate-400",
};

interface ForwardedRow {
  candidate: Candidate;
  forwardedAt: string;
}

function DetailItem({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-slate-200">{value}</div>
    </div>
  );
}

function NoteEditor({ candidate, onSaved }: { candidate: Candidate; onSaved: (note: string) => void }) {
  const [value, setValue] = useState(candidate.interviewerNote ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = value !== (candidate.interviewerNote ?? "");

  const save = async () => {
    setSaving(true);
    try {
      await updateCandidateInterviewerNote(candidate.id, value);
      // Same "who changed this field" log the Hiring table's own note editor
      // writes to (hr_candidate_field_edits) — without this, HR's candidate
      // detail popup shows a blank "Changed by" for a note saved from here.
      void logCandidateFieldEdit(candidate.id, "interviewerNote");
      onSaved(value.trim());
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save note.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Your notes from the interview…"
        rows={2}
        className="glass-input text-sm w-full resize-y min-h-[2.5rem]"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {saving ? "Saving…" : "Save Note"}
        </button>
        {saved && <span className="inline-flex items-center gap-1 text-xs text-green-400"><Check className="h-3.5 w-3.5" /> Saved</span>}
      </div>
    </div>
  );
}

export function CandidateReviewsPage() {
  const navigate = useNavigate();
  const { uid, ready } = useAuth();
  const [rows, setRows] = useState<ForwardedRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cvLoadingId, setCvLoadingId] = useState<string | null>(null);
  // "List" (the original view) vs "Calendar" — the same InterviewCalendarTab
  // HR's own dashboard uses, just fed only the candidates forwarded to THIS
  // viewer (rows, already personalized by getCvForwardsForRecipient above)
  // instead of the company's full interviewing list. Since Candidate Reviews
  // is reachable from every module now, this gives each module's own
  // recipients a personalized interview calendar without needing a separate
  // page/tile per module.
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  // Deep-linked from a Forward Candidate message's "Open in Candidate
  // Reviews" link (MessageBody.tsx's candidate-review: pseudo-link) — a
  // #candidateId=... hash, same style as the Staff Checklist deep link.
  const [focusedCandidateId] = useState<string | null>(() => {
    const m = window.location.hash.match(/candidateId=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  });

  const load = async () => {
    if (!uid) return;
    setLoading(true);
    setLoadError(null);
    try {
      const myProfileId = await getMyProfileId(uid);
      if (!myProfileId) throw new Error("Could not resolve your profile.");
      const [forwardRows, profileRows] = await Promise.all([getCvForwardsForRecipient(myProfileId), getCompanyUsers()]);
      setRows(forwardRows);
      setProfiles(profileRows);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load candidates.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ready && uid) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, uid]);

  // assignedInterviewerId/branchManagerId/assignedManagerId are all plain
  // profiles.id UUIDs on the candidate row — resolve to display names here
  // rather than showing the raw id.
  const profileNameById = useMemo(() => new Map(profiles.map((p) => [p.id, p.display_name || p.email])), [profiles]);

  // Same "interviewing status + a date on record" filter InterviewCalendarTab's
  // one other caller (ReportHRDaily.tsx) uses — just over `rows` (already
  // scoped to this viewer) instead of the company's whole candidate list.
  const calendarCandidates = useMemo<InterviewCalendarCandidate[]>(
    () =>
      rows
        .filter((r): r is ForwardedRow & { candidate: Candidate & { interviewDate: string } } => r.candidate.status === "interviewing" && !!r.candidate.interviewDate)
        .map(({ candidate: c }) => ({
          id: c.id,
          name: c.name,
          position: c.position,
          branch: c.branch,
          phone: c.phone,
          email: c.email,
          interviewDate: c.interviewDate,
          interviewTime: c.interviewTime,
          interviewTimezone: c.interviewTimezone,
          interviewerName: (c.assignedInterviewerId && profileNameById.get(c.assignedInterviewerId)) || null,
          notes: c.notes,
        })),
    [rows, profileNameById]
  );

  useEffect(() => {
    if (!focusedCandidateId || rows.length === 0) return;
    document.getElementById(`candidate-${focusedCandidateId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusedCandidateId, rows]);

  const openCv = async (candidate: Candidate) => {
    if (!candidate.cvPath) return;
    setCvLoadingId(candidate.id);
    try {
      const url = await getCandidateCvUrlForForwarding(candidate.cvPath);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to open CV.");
    } finally {
      setCvLoadingId(null);
    }
  };

  return (
    <main className="max-w-[1000px] mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={() => navigate({ to: "/m/$module", params: { module: "hr" } })}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-slate-300 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-xl font-bold text-white">
            <ClipboardList className="h-5 w-5" /> Candidate Reviews
          </h1>
          <p className="text-sm text-slate-400">Candidates HR has forwarded to you — leave your interviewer notes here.</p>
        </div>
        <div className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
              viewMode === "list" ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <ListIcon className="h-3.5 w-3.5" /> List
          </button>
          <button
            type="button"
            onClick={() => setViewMode("calendar")}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
              viewMode === "calendar" ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <CalendarIcon className="h-3.5 w-3.5" /> Calendar
          </button>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {loadError && <p className="text-sm text-red-400 mb-4">{loadError}</p>}

      {loading ? (
        <p className="text-sm text-slate-400 py-8 text-center">Loading…</p>
      ) : viewMode === "calendar" ? (
        <InterviewCalendarTab candidates={calendarCandidates} onGoToHiring={() => setViewMode("list")} goToLabel="View in List" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400 py-8 text-center">
          No candidates have been forwarded to you yet — check back after HR sends you one.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map(({ candidate, forwardedAt }) => (
            <div
              key={candidate.id}
              id={`candidate-${candidate.id}`}
              className={`rounded-xl border p-4 ${
                candidate.id === focusedCandidateId ? "border-blue-400/60 bg-blue-500/10 ring-1 ring-blue-400/40" : "border-white/10 bg-white/5"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">{candidate.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_COLOR[candidate.status]}`}>
                      {STATUS_LABEL[candidate.status]}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">Forwarded {new Date(forwardedAt).toLocaleDateString()}</p>
                </div>
                {candidate.cvPath && (
                  <button
                    type="button"
                    onClick={() => void openCv(candidate)}
                    disabled={cvLoadingId === candidate.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white shrink-0 disabled:opacity-40"
                  >
                    {cvLoadingId === candidate.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                    View CV
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs mb-3 rounded-lg border border-white/5 bg-black/20 px-3 py-2.5">
                <DetailItem label="Position" value={candidate.position} />
                <DetailItem label="Branch" value={candidate.branch} />
                <DetailItem label="Department" value={candidate.department} />
                <DetailItem label="Source" value={candidate.source} />
                <DetailItem label="Phone" value={candidate.phone} />
                <DetailItem label="Email" value={candidate.email} />
                <DetailItem label="Applied" value={candidate.createdAt ? new Date(candidate.createdAt).toLocaleDateString() : null} />
                <DetailItem label="Added By" value={candidate.createdByName} />
                <DetailItem label="Assigned Interviewer" value={candidate.assignedInterviewerId ? profileNameById.get(candidate.assignedInterviewerId) : null} />
                <DetailItem label="Assigned Manager" value={candidate.assignedManagerId ? profileNameById.get(candidate.assignedManagerId) : null} />
                <DetailItem label="Branch Manager" value={candidate.branchManagerId ? profileNameById.get(candidate.branchManagerId) : null} />
                <DetailItem
                  label="Interview"
                  value={
                    candidate.interviewDate
                      ? `${new Date(candidate.interviewDate).toLocaleDateString()}${candidate.interviewTime ? ` ${candidate.interviewTime}` : ""}${candidate.interviewTimezone ? ` ${candidate.interviewTimezone}` : ""}`
                      : null
                  }
                />
                <DetailItem label="Screening Date" value={candidate.screeningDate ? new Date(candidate.screeningDate).toLocaleDateString() : null} />
                <DetailItem label="Training Start" value={candidate.trainingStartDate ? new Date(candidate.trainingStartDate).toLocaleDateString() : null} />
                <DetailItem label="Training End" value={candidate.trainingEndDate ? new Date(candidate.trainingEndDate).toLocaleDateString() : null} />
                <DetailItem label="Start Date" value={candidate.startDate ? new Date(candidate.startDate).toLocaleDateString() : null} />
                <DetailItem label="Withdrawn Date" value={candidate.withdrawnDate ? new Date(candidate.withdrawnDate).toLocaleDateString() : null} />
                <DetailItem label="Document Verified" value={candidate.documentVerified ? "Yes" : null} />
                <DetailItem label="Texted" value={[candidate.textedAm && "AM", candidate.textedPm && "PM"].filter(Boolean).join(" / ") || null} />
                <DetailItem label="Called" value={[candidate.calledAm && "AM", candidate.calledPm && "PM"].filter(Boolean).join(" / ") || null} />
              </div>

              {candidate.notes && (
                <p className="text-xs text-slate-400 mb-3">
                  <span className="text-[10px] uppercase tracking-wide text-slate-500 mr-1.5">HR Note:</span>
                  {candidate.notes}
                </p>
              )}

              <NoteEditor
                candidate={candidate}
                onSaved={(note) =>
                  setRows((prev) => prev.map((r) => (r.candidate.id === candidate.id ? { ...r, candidate: { ...r.candidate, interviewerNote: note } } : r)))
                }
              />
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
