/**
 * Mobile "Ticket Attendance" — did each technician actually check into
 * their scheduled tickets today (On-Site Check-In)? Same underlying data as
 * the desktop TicketAttendanceTab, rebuilt as a mobile-native card list
 * (that component is a wide admin table, not reused here) and scoped to a
 * fixed role hierarchy instead of the desktop tab's page-level admin gate:
 *
 *   SuperAdmin / Technical Director / Technical Assistant Director — see
 *   the whole company.
 *   Senior Branch Manager / Branch Manager — see themselves plus everyone
 *   below them in the profiles.manager_name chain, walked transitively (a
 *   Senior Branch Manager sees their own Branch Managers AND every
 *   technician under those Branch Managers, not just one level down).
 *   Everyone else (Technicians included) — see only their own row.
 *
 * Always shown as a Home tile (MobileTechApp.tsx) — there's no separate
 * "show" gate the way Clock In Team has one, since a plain Technician
 * seeing just their own ticket attendance is itself a valid, intended view.
 *
 * List cards navigate into a detail screen on tap (not an inline expand) —
 * a full-height screen has room to show BOTH Arrived and Done per ticket
 * (so a "missing check-out" summary count is actually traceable to which
 * ticket caused it, which an inline-collapsed row didn't have space for)
 * plus an editable "why are they absent" note, same (profile, day) note
 * Attendance Monitoring/Ticket Attendance's desktop Notes column already
 * write to (attendanceNotes.ts).
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Pencil, Loader2, Eye, X, Search } from "lucide-react";
import { getCompanyTicketAttendance, type TicketAttendanceRow } from "@/lib/supabase/technicianWhereabouts";
import { getCompanyTimecardEntries, type CompanyTimecardEntry } from "@/lib/supabase/timecards";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getAttendanceNotes, upsertAttendanceNote, type AttendanceNoteRow } from "@/lib/supabase/attendanceNotes";
import { ROLE_LABELS } from "@/lib/roleLabels";
import { useAuth } from "@/lib/auth";

const FULL_ACCESS_ROLES = new Set(["SUPERADMIN", "TECHNICAL_DIRECTOR", "TECHNICAL_ASSISTANT_DIRECTOR"]);
const MANAGER_TIER_ROLES = new Set(["SENIOR_BRANCH_MANAGER", "BRANCH_MANAGER"]);

function heldRoles(p: Pick<ProfileRow, "role" | "extra_roles">): string[] {
  return [p.role, ...(p.extra_roles ?? [])].map((r) => (r || "").toUpperCase());
}

/**
 * Returns the set of lowercase-trimmed display names this viewer may see
 * (matched against tickets.technician, a free-text field — same convention
 * TicketAttendanceTab itself already uses), or null for unrestricted.
 */
function visibleTechnicianNamesForHierarchy(viewer: ProfileRow, allProfiles: ProfileRow[]): Set<string> | null {
  const roles = heldRoles(viewer);
  if (roles.some((r) => FULL_ACCESS_ROLES.has(r))) return null;
  const viewerName = (viewer.display_name || "").trim().toLowerCase();
  if (!roles.some((r) => MANAGER_TIER_ROLES.has(r))) {
    return viewerName ? new Set([viewerName]) : new Set();
  }
  const visible = new Set<string>();
  const queue = viewerName ? [viewerName] : [];
  while (queue.length) {
    const current = queue.shift()!;
    if (visible.has(current)) continue;
    visible.add(current);
    for (const p of allProfiles) {
      const name = (p.display_name || "").trim().toLowerCase();
      const mgr = (p.manager_name || "").trim().toLowerCase();
      if (name && mgr === current && !visible.has(name)) queue.push(name);
    }
  }
  return visible;
}

interface TechSummary {
  technician: string;
  profileId: string | null;
  branch: string | null;
  timeIn: string | null;
  timeOut: string | null;
  scheduled: number;
  checkedIn: number;
  missingCheckIn: number;
  missingCheckOut: number;
  note: string;
  tickets: TicketAttendanceRow[];
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function MobileTicketAttendanceView({ profileId }: { profileId: string | null }) {
  const { companyId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [allProfiles, setAllProfiles] = useState<ProfileRow[]>([]);
  const [ticketRows, setTicketRows] = useState<TicketAttendanceRow[]>([]);
  const [timecards, setTimecards] = useState<CompanyTimecardEntry[]>([]);
  const [noteRows, setNoteRows] = useState<AttendanceNoteRow[]>([]);
  const [detailTechnician, setDetailTechnician] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  // Present = clocked in today (Time In set); Absent = not clocked in at
  // all. Based on the general clock Time In this card already shows, same
  // as the desktop Ticket Attendance tab's own Status filter convention.
  const [statusFilter, setStatusFilter] = useState<"all" | "present" | "absent">("all");
  // "View As" — a testing aid so a full-access viewer (SuperAdmin/Technical
  // Director/Technical Assistant Director) can preview this dashboard
  // exactly as any other named employee would see it, without needing
  // their password. Purely a local re-filter of the SAME company-wide data
  // the real viewer already received (they're full-access, so nothing new
  // is exposed) — no extra fetch, no RLS/backend involvement. Read-only:
  // note-editing is disabled while simulating someone else.
  const [viewAsProfileId, setViewAsProfileId] = useState<string | null>(null);
  const [viewAsPickerOpen, setViewAsPickerOpen] = useState(false);
  const [viewAsSearch, setViewAsSearch] = useState("");

  const todayKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }, []);

  const load = async () => {
    if (!profileId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [profiles, tickets, tc, notes] = await Promise.all([
        getCompanyUsers(),
        getCompanyTicketAttendance(todayKey, todayKey),
        getCompanyTimecardEntries(todayKey, todayKey).catch(() => [] as CompanyTimecardEntry[]),
        getAttendanceNotes(todayKey, todayKey).catch(() => [] as AttendanceNoteRow[]),
      ]);
      setAllProfiles(profiles);
      setTicketRows(tickets);
      setTimecards(tc);
      setNoteRows(notes);
    } catch (e) {
      console.error("MobileTicketAttendanceView: load failed", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  const realViewer = useMemo(() => allProfiles.find((p) => p.id === profileId) ?? null, [allProfiles, profileId]);
  const isFullAccessReal = realViewer ? heldRoles(realViewer).some((r) => FULL_ACCESS_ROLES.has(r)) : false;
  const viewAsProfile = viewAsProfileId ? allProfiles.find((p) => p.id === viewAsProfileId) ?? null : null;
  // Only an actual full-access viewer can simulate someone else — this is
  // the entry-point gate, not just a UI toggle: a manager-tier viewer never
  // gets the "View As" control rendered at all.
  const effectiveViewer = isFullAccessReal && viewAsProfile ? viewAsProfile : realViewer;

  const { rows, unrestricted } = useMemo(() => {
    if (!effectiveViewer) return { rows: [] as TechSummary[], unrestricted: false };
    const visibleNames = visibleTechnicianNamesForHierarchy(effectiveViewer, allProfiles);
    const employeeByName = new Map(allProfiles.map((p) => [(p.display_name || "").trim().toLowerCase(), p]));
    const timecardByProfile = new Map(timecards.map((t) => [t.profileId, t]));
    const noteByProfile = new Map(noteRows.map((n) => [n.profileId, n]));

    const byTech = new Map<string, TicketAttendanceRow[]>();
    for (const r of ticketRows) {
      const key = r.technician.trim().toLowerCase();
      if (visibleNames && !visibleNames.has(key)) continue;
      if (!byTech.has(r.technician)) byTech.set(r.technician, []);
      byTech.get(r.technician)!.push(r);
    }
    const built: TechSummary[] = Array.from(byTech.entries())
      .map(([technician, techRows]) => {
        const employee = employeeByName.get(technician.trim().toLowerCase());
        const tc = employee ? timecardByProfile.get(employee.id) : undefined;
        const note = employee ? noteByProfile.get(employee.id) : undefined;
        return {
          technician,
          profileId: employee?.id || null,
          branch: employee?.assigned_branch || null,
          timeIn: tc?.checkIn || null,
          timeOut: tc?.checkOut || null,
          scheduled: techRows.length,
          checkedIn: techRows.filter((r) => r.arrivedAt).length,
          missingCheckIn: techRows.filter((r) => !r.arrivedAt && r.statusGroup !== "cancelled").length,
          missingCheckOut: techRows.filter((r) => r.arrivedAt && !r.doneAt && r.statusGroup !== "cancelled").length,
          note: note?.content || "",
          tickets: techRows.slice().sort((a, b) => (a.timeSlot || "").localeCompare(b.timeSlot || "")),
        };
      })
      .sort((a, b) => a.technician.localeCompare(b.technician));
    return { rows: built, unrestricted: visibleNames === null };
  }, [effectiveViewer, allProfiles, ticketRows, timecards, noteRows]);

  const detail = detailTechnician ? rows.find((r) => r.technician === detailTechnician) ?? null : null;

  const filteredRows = rows.filter((t) => {
    if (statusFilter === "present") return !!t.timeIn;
    if (statusFilter === "absent") return !t.timeIn;
    return true;
  });

  const viewAsResults = allProfiles
    .filter((p) => p.id !== profileId && (p.display_name || p.email || "").toLowerCase().includes(viewAsSearch.trim().toLowerCase()))
    .sort((a, b) => (a.display_name || a.email).localeCompare(b.display_name || b.email))
    .slice(0, 30);

  const exitViewAs = () => {
    setViewAsProfileId(null);
    setDetailTechnician(null);
    setEditingNote(false);
  };

  const handleSaveNote = async () => {
    if (!detail?.profileId || viewAsProfileId || !companyId) return;
    const content = noteDraft;
    setSavingNote(true);
    try {
      await upsertAttendanceNote({
        profileId: detail.profileId,
        noteDate: todayKey,
        content,
        notifyIndividual: false,
        notifyTeamLead: false,
        createdBy: profileId,
        companyId,
      });
      setNoteRows((prev) => {
        const existing = prev.find((n) => n.profileId === detail.profileId);
        return [
          ...prev.filter((n) => n.profileId !== detail.profileId),
          {
            profileId: detail.profileId!,
            noteDate: todayKey,
            content,
            hrNote: existing?.hrNote || "",
            notifyIndividual: false,
            notifyTeamLead: false,
            createdBy: profileId,
            attachmentPath: existing?.attachmentPath ?? null,
            attachmentAddedBy: existing?.attachmentAddedBy ?? null,
            attachmentAddedAt: existing?.attachmentAddedAt ?? null,
            attachmentRemovedBy: existing?.attachmentRemovedBy ?? null,
            attachmentRemovedAt: existing?.attachmentRemovedAt ?? null,
          },
        ];
      });
      setEditingNote(false);
    } catch (e) {
      alert(`Failed to save note: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setSavingNote(false);
    }
  };

  if (detail) {
    return (
      <div className="mtech-scroll mtech-clockin">
        <button
          type="button"
          onClick={() => { setDetailTechnician(null); setEditingNote(false); }}
          style={{
            display: "flex", alignItems: "center", gap: "0.3rem", background: "none", border: "none",
            color: "var(--mt-blue)", fontSize: "0.85rem", fontWeight: 700, padding: "0.2rem 0", cursor: "pointer",
          }}
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </button>

        {viewAsProfile && (
          <button type="button" className="mtech-home-reportbanner" onClick={exitViewAs}>
            <span>Viewing as <strong>{viewAsProfile.display_name || viewAsProfile.email}</strong> — {ROLE_LABELS[viewAsProfile.role] || viewAsProfile.role}</span>
            <span className="mtech-home-reportbanner-back">Exit ‹</span>
          </button>
        )}

        <div className="mtech-clockin-heading">
          <div className="mtech-clockin-title">{detail.technician}</div>
          <div className="mtech-clockin-sub">
            {detail.branch || "No branch"}
            {detail.timeIn ? ` · In ${detail.timeIn.slice(0, 5)}` : " · Not clocked in"}
            {detail.timeOut ? ` · Out ${detail.timeOut.slice(0, 5)}` : ""}
          </div>
          <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.9rem", fontSize: "0.78rem" }}>
            <span style={{ color: "#6ee7b7", fontWeight: 700 }}>{detail.checkedIn}/{detail.scheduled} checked in</span>
            {detail.missingCheckIn > 0 && <span style={{ color: "#f87171", fontWeight: 700 }}>{detail.missingCheckIn} missing check-in</span>}
            {detail.missingCheckOut > 0 && <span style={{ color: "#fde047", fontWeight: 700 }}>{detail.missingCheckOut} missing check-out</span>}
          </div>
        </div>

        <div className="mtech-clockin-heading">
          <div className="mtech-clockin-sub" style={{ marginBottom: "0.4rem", marginTop: 0 }}>Notes</div>
          {!detail.profileId ? (
            <div className="mtech-muted" style={{ padding: 0 }}>No matching profile — can't attach a note.</div>
          ) : viewAsProfileId ? (
            <div style={{ color: detail.note ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.5)", fontSize: "0.85rem" }}>
              {detail.note || "No note"} <span style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.5)" }}>(read-only while viewing as someone else)</span>
            </div>
          ) : editingNote ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              <textarea
                autoFocus
                rows={3}
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Why are they absent?"
                style={{
                  width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid var(--mt-surface-border)",
                  borderRadius: "8px", padding: "0.5rem", color: "#fff", fontSize: "0.85rem", fontFamily: "inherit", resize: "none",
                }}
              />
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" className="mtech-clockin-btn" disabled={savingNote} onClick={() => void handleSaveNote()}>
                  {savingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                </button>
                <button
                  type="button"
                  disabled={savingNote}
                  onClick={() => setEditingNote(false)}
                  style={{ padding: "0.5rem 0.9rem", borderRadius: "10px", border: "1px solid var(--mt-surface-border)", background: "none", color: "rgba(255,255,255,0.85)", fontSize: "0.82rem", fontWeight: 700 }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setEditingNote(true); setNoteDraft(detail.note); }}
              style={{ display: "flex", alignItems: "flex-start", gap: "0.4rem", background: "none", border: "none", padding: 0, textAlign: "left", color: detail.note ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.5)", fontSize: "0.85rem", cursor: "pointer" }}
            >
              <span>{detail.note || "Add note"}</span>
              <Pencil className="h-3 w-3" style={{ marginTop: "0.2rem", flexShrink: 0, opacity: 0.6 }} />
            </button>
          )}
        </div>

        <div className="mtech-clockin-list">
          {detail.tickets.length === 0 ? (
            <div className="mtech-muted">No tickets.</div>
          ) : (
            detail.tickets.map((tk) => {
              const missingIn = !tk.arrivedAt && tk.statusGroup !== "cancelled";
              const missingOut = !!tk.arrivedAt && !tk.doneAt && tk.statusGroup !== "cancelled";
              return (
                <div key={tk.ticketNo} className="mtech-clockin-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
                  <div className="mtech-clockin-row-name" style={{ fontSize: "0.82rem" }}>{tk.ticketNo}</div>
                  <div className="mtech-clockin-row-status">
                    {tk.timeSlot ? `${tk.timeSlot} · ` : ""}{tk.status}
                  </div>
                  <div style={{ display: "flex", gap: "1rem", marginTop: "0.4rem", fontSize: "0.78rem" }}>
                    <span style={{ color: tk.arrivedAt ? "#6ee7b7" : missingIn ? "#f87171" : "rgba(255,255,255,0.5)", fontWeight: missingIn ? 700 : 500 }}>
                      Arrived: {tk.arrivedAt ? fmtTime(tk.arrivedAt) : missingIn ? "Missing" : "—"}
                    </span>
                    <span style={{ color: tk.doneAt ? "#6ee7b7" : missingOut ? "#fde047" : "rgba(255,255,255,0.5)", fontWeight: missingOut ? 700 : 500 }}>
                      Done: {tk.doneAt ? fmtTime(tk.doneAt) : missingOut ? "Missing" : "—"}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mtech-scroll mtech-clockin">
      <div className="mtech-clockin-heading" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.6rem" }}>
        <div>
          <div className="mtech-clockin-title">Ticket Attendance</div>
          <div className="mtech-clockin-sub">
            {unrestricted ? "Every technician, today" : "You and your team, today"}
          </div>
        </div>
        {isFullAccessReal && (
          <button
            type="button"
            onClick={() => setViewAsPickerOpen(true)}
            style={{
              display: "flex", alignItems: "center", gap: "0.3rem", flexShrink: 0,
              padding: "0.4rem 0.7rem", borderRadius: "8px", border: "1px solid var(--mt-surface-border)",
              background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.85)", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer",
            }}
          >
            <Eye className="h-3.5 w-3.5" /> View As
          </button>
        )}
      </div>

      {viewAsProfile && (
        <button type="button" className="mtech-home-reportbanner" onClick={exitViewAs}>
          <span>Viewing as <strong>{viewAsProfile.display_name || viewAsProfile.email}</strong> — {ROLE_LABELS[viewAsProfile.role] || viewAsProfile.role}</span>
          <span className="mtech-home-reportbanner-back">Exit ‹</span>
        </button>
      )}

      {viewAsPickerOpen && (
        <div
          onClick={() => setViewAsPickerOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 50, display: "flex", alignItems: "flex-end" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxHeight: "75vh", background: "var(--mt-surface)", borderTop: "1px solid var(--mt-surface-border)",
              borderRadius: "16px 16px 0 0", padding: "1rem", display: "flex", flexDirection: "column", gap: "0.7rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 800, fontSize: "1rem", color: "rgba(255,255,255,0.92)" }}>View As</div>
              <button type="button" onClick={() => setViewAsPickerOpen(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.7)", cursor: "pointer" }}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div style={{ position: "relative" }}>
              <Search className="h-3.5 w-3.5" style={{ position: "absolute", left: "0.7rem", top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.5)" }} />
              <input
                autoFocus
                type="text"
                value={viewAsSearch}
                onChange={(e) => setViewAsSearch(e.target.value)}
                placeholder="Search by name…"
                style={{
                  width: "100%", padding: "0.55rem 0.7rem 0.55rem 2rem", borderRadius: "10px", border: "1px solid var(--mt-surface-border)",
                  background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: "0.85rem", fontFamily: "inherit",
                }}
              />
            </div>
            <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              {viewAsResults.length === 0 && <div className="mtech-muted">No matches.</div>}
              {viewAsResults.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setViewAsProfileId(p.id);
                    setViewAsPickerOpen(false);
                    setViewAsSearch("");
                    setDetailTechnician(null);
                  }}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%",
                    padding: "0.6rem 0.7rem", borderRadius: "10px", border: "1px solid var(--mt-surface-border)",
                    background: "var(--mt-surface)", color: "rgba(255,255,255,0.92)", fontSize: "0.85rem", cursor: "pointer", textAlign: "left",
                  }}
                >
                  <span style={{ fontWeight: 700 }}>{p.display_name || p.email}</span>
                  <span style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.6)" }}>{ROLE_LABELS[p.role] || p.role}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: "0.4rem" }}>
        {([
          ["all", "All"],
          ["present", "Present"],
          ["absent", "Absent"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setStatusFilter(key)}
            style={{
              flex: 1,
              padding: "0.5rem 0",
              borderRadius: "10px",
              border: `1px solid ${statusFilter === key ? "var(--mt-blue)" : "var(--mt-surface-border)"}`,
              background: statusFilter === key ? "rgba(59,130,246,0.18)" : "var(--mt-surface)",
              color: statusFilter === key ? "var(--mt-blue)" : "rgba(255,255,255,0.85)",
              fontSize: "0.8rem",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && <div className="mtech-muted">Loading…</div>}
      {!loading && rows.length === 0 && <div className="mtech-muted">No tickets scheduled today.</div>}
      {!loading && rows.length > 0 && filteredRows.length === 0 && <div className="mtech-muted">No technicians match this filter.</div>}

      <div className="mtech-clockin-list">
        {filteredRows.map((t) => {
          const hasMissingIn = t.missingCheckIn > 0;
          return (
            <div
              key={t.technician}
              className="mtech-clockin-row"
              style={{ cursor: "pointer" }}
              onClick={() => setDetailTechnician(t.technician)}
            >
              <div>
                <div className="mtech-clockin-row-name">{t.technician}</div>
                <div className="mtech-clockin-row-status">
                  {t.branch || "No branch"}
                  {t.timeIn ? ` · In ${t.timeIn.slice(0, 5)}` : " · Not clocked in"}
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: "0.75rem", flexShrink: 0 }}>
                <div style={{ color: "#6ee7b7", fontWeight: 700 }}>{t.checkedIn}/{t.scheduled} checked in</div>
                {hasMissingIn && <div style={{ color: "#f87171", fontWeight: 700 }}>{t.missingCheckIn} missing check-in</div>}
                {!hasMissingIn && t.missingCheckOut > 0 && (
                  <div style={{ color: "#fde047", fontWeight: 700 }}>{t.missingCheckOut} missing check-out</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
