/**
 * Ticket Time Disputes — employee_requests rows with request_type
 * "ticket_time_dispute", submitted from the mobile tech app when an
 * on-site check-in failed to register (GPS/radius issue) and the
 * technician is reporting the real start/end time. Approving writes those
 * times straight onto the disputed ticket's own onsite_arrived_at/
 * onsite_done_at columns — the same columns the mobile Work Start/Work
 * Done buttons write.
 *
 * Self-contained: fetches its own data independently (own employees list,
 * own dispute rows) rather than depending on a parent page's unrelated
 * state, so the exact same tab can be rendered from more than one page —
 * Accounting Dashboard's "Ticket Time Disputes" tab and Absent List's tab
 * of the same name both mount this directly. Mirrors TicketAttendanceTab.tsx's
 * own self-containment for the same reason.
 */
import { useEffect, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { normalizeRole } from "@/lib/roleLabels";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { getProfileIdByFirebaseUid } from "@/lib/supabase/timecards";
import { getCompanyEmployeeRequests, updateEmployeeRequestStatus, type EmployeeRequestRow } from "@/lib/supabase/employeeRequests";
import { setTicketOnsiteCheckIn } from "@/lib/supabase/tickets";
import { resetMileageRouteConfirmation } from "@/lib/supabase/mileage";
import { TIME_ZONES, type ScheduleTimezone } from "@/lib/serverTime";

const isPdfAttachment = (url: string) => /\.pdf(\?|$)/i.test(url);

export function TicketTimeDisputesTab() {
  const { uid, role, extraRoles } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  useEffect(() => {
    if (!uid) return;
    getProfileIdByFirebaseUid(uid).then(setMyProfileId).catch(() => {});
  }, [uid]);

  // Same gate Attendance Monitoring's Disputes & Inquiries tab uses.
  const isFullRequestsAdmin = [role, ...(extraRoles ?? [])].some((r) => ["ADMIN", "SUPERADMIN", "HR", "FINANCE"].includes(normalizeRole(r)));

  const [employees, setEmployees] = useState<ProfileRow[]>([]);
  useEffect(() => {
    if (!isFullRequestsAdmin) return;
    getCompanyUsers().then(setEmployees).catch((err) => console.error("Failed to load employees:", err));
  }, [isFullRequestsAdmin]);
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const profileName = (id: string | null) => {
    if (!id) return "—";
    const e = employeeById.get(id);
    return e?.display_name || e?.email || "—";
  };
  // The disputing technician's own scheduled timezone (CST/EST) — a claimed
  // time is stored in real UTC but should always be shown labeled in the
  // technician's own zone, not the reviewer's (same convention Time Clock/
  // mobile use).
  const profileTimezone = (id: string | null): ScheduleTimezone => {
    if (!id) return "CST";
    return employeeById.get(id)?.schedule_timezone || "CST";
  };
  const fmtTimeInZone = (iso: string | null, tz: ScheduleTimezone): string =>
    iso ? new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONES[tz].timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "?";

  const [previewAttachmentUrl, setPreviewAttachmentUrl] = useState<string | null>(null);

  const [ticketTimeDisputes, setTicketTimeDisputes] = useState<EmployeeRequestRow[]>([]);
  const [ticketTimeDisputesLoaded, setTicketTimeDisputesLoaded] = useState(false);
  const [ticketTimeDisputeNote, setTicketTimeDisputeNote] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!isFullRequestsAdmin || ticketTimeDisputesLoaded) return;
    getCompanyEmployeeRequests()
      .then((rows) => { setTicketTimeDisputes(rows.filter((r) => r.requestType === "ticket_time_dispute")); setTicketTimeDisputesLoaded(true); })
      .catch((err) => console.error("Failed to load ticket time disputes:", err));
  }, [isFullRequestsAdmin, ticketTimeDisputesLoaded]);
  const [ticketTimeDisputeSubTab, setTicketTimeDisputeSubTab] = useState<"pending" | "history">("pending");
  const pendingTicketTimeDisputes = ticketTimeDisputes.filter((r) => r.status === "pending");
  const historyTicketTimeDisputes = ticketTimeDisputes
    .filter((r) => r.status === "approved" || r.status === "rejected")
    .sort((a, b) => (b.reviewedAt || b.createdAt).localeCompare(a.reviewedAt || a.createdAt));

  // Approving doesn't just change the request's own status — it writes the
  // technician's claimed start/end time straight onto the disputed ticket's
  // own onsite_arrived_at/onsite_done_at columns. "arrived" must go first:
  // setTicketOnsiteCheckIn's own "arrived" path clears onsite_done_at as a
  // side effect, so doing "done" first would just get wiped out.
  const handleTicketTimeDisputeAction = async (id: string, status: "approved" | "rejected") => {
    try {
      if (status === "approved") {
        const dispute = ticketTimeDisputes.find((d) => d.id === id);
        if (dispute?.ticketNo && dispute.disputedStartTime && dispute.disputedEndTime) {
          await setTicketOnsiteCheckIn(dispute.ticketNo, "arrived", dispute.disputedStartTime);
          await setTicketOnsiteCheckIn(dispute.ticketNo, "done", dispute.disputedEndTime);
          // The corrected time can move this ticket earlier/later in its
          // day's real visit order — invalidate that day's mileage
          // route-order confirmation so the next Mileage sync re-chains it
          // against the corrected time instead of skipping it as settled.
          await resetMileageRouteConfirmation(dispute.ticketNo).catch((err) =>
            console.error("Failed to invalidate mileage route order after dispute approval:", err)
          );
        }
      }
      await updateEmployeeRequestStatus(id, status, myProfileId, ticketTimeDisputeNote[id]);
      const rows = await getCompanyEmployeeRequests();
      setTicketTimeDisputes(rows.filter((r) => r.requestType === "ticket_time_dispute"));
      setTicketTimeDisputeNote((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      alert(`Failed to update request: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  if (!isFullRequestsAdmin) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
          <p className="text-xs text-slate-400 mb-1">Pending Ticket Time Disputes</p>
          <p className="text-2xl font-bold text-yellow-300">{pendingTicketTimeDisputes.length}</p>
        </div>
        <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
          <p className="text-xs text-slate-400 mb-1">Resolved (History)</p>
          <p className="text-2xl font-bold text-slate-300">{historyTicketTimeDisputes.length}</p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-white/10">
        <button
          type="button"
          onClick={() => setTicketTimeDisputeSubTab("pending")}
          className={`px-4 py-2 border-b-2 transition text-sm font-medium ${ticketTimeDisputeSubTab === "pending" ? "border-yellow-400 text-yellow-300" : "border-transparent text-slate-400 hover:text-slate-300"}`}
        >
          Pending
        </button>
        <button
          type="button"
          onClick={() => setTicketTimeDisputeSubTab("history")}
          className={`px-4 py-2 border-b-2 transition text-sm font-medium ${ticketTimeDisputeSubTab === "history" ? "border-blue-400 text-blue-300" : "border-transparent text-slate-400 hover:text-slate-300"}`}
        >
          History
        </button>
      </div>

      {ticketTimeDisputeSubTab === "pending" && (
      <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
        <h3 className="text-sm font-bold text-white mb-4">Ticket Time Disputes — Pending</h3>
        <p className="text-xs text-slate-400 mb-4">
          A technician's on-site check-in failed to register (GPS/radius issue) and they're reporting the real start/end time. Approving writes these times straight onto the ticket's own check-in record.
        </p>
        {pendingTicketTimeDisputes.length === 0 ? (
          <p className="text-sm text-slate-400">No pending ticket time disputes.</p>
        ) : (
          <div className="space-y-3">
            {pendingTicketTimeDisputes.map((r) => (
              <div key={r.id} className="border border-white/10 rounded-lg p-3">
                <p className="text-sm font-semibold text-white">{profileName(r.profileId)}</p>
                <p className="text-xs text-slate-400 mt-1">Submitted: {r.createdAt.slice(0, 10)}</p>
                {r.ticketNo && (
                  <p className="text-sm mt-2">
                    Ticket:{" "}
                    <a href={`/ticket/${r.ticketNo}`} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:text-blue-200 hover:underline font-semibold">
                      {r.ticketNo}
                    </a>
                  </p>
                )}
                {(r.disputedStartTime || r.disputedEndTime) && (
                  <p className="text-sm text-slate-300 mt-1">
                    Claimed time:{" "}
                    <span className="font-semibold text-white">
                      {fmtTimeInZone(r.disputedStartTime, profileTimezone(r.profileId))}
                      {" – "}
                      {fmtTimeInZone(r.disputedEndTime, profileTimezone(r.profileId))}
                      {" "}{profileTimezone(r.profileId)}
                    </span>
                  </p>
                )}
                <p className="text-sm text-slate-300 mt-2">{r.details}</p>
                {r.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {r.attachments.map((a) => (
                      <button
                        key={a.url}
                        type="button"
                        onClick={() => setPreviewAttachmentUrl(a.url)}
                        title={a.name}
                        className="block h-12 w-12 overflow-hidden rounded border border-white/10 bg-slate-800 hover:border-blue-500 transition"
                      >
                        {isPdfAttachment(a.url) ? (
                          <span className="flex h-full w-full items-center justify-center text-slate-400">
                            <Paperclip className="h-4 w-4" />
                          </span>
                        ) : (
                          <img src={a.url} alt={a.name} className="h-full w-full object-cover" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  placeholder="Optional response note (visible to the employee)..."
                  value={ticketTimeDisputeNote[r.id] || ""}
                  onChange={(e) => setTicketTimeDisputeNote({ ...ticketTimeDisputeNote, [r.id]: e.target.value })}
                  rows={2}
                  className="w-full mt-2 px-3 py-2 bg-slate-800 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-blue-500 placeholder-slate-500"
                />
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => handleTicketTimeDisputeAction(r.id, "approved")}
                    className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold transition"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTicketTimeDisputeAction(r.id, "rejected")}
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold transition"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {ticketTimeDisputeSubTab === "history" && (
      <div className="bg-slate-900/50 border border-white/10 rounded-lg p-4">
        <h3 className="text-sm font-bold text-white mb-4">Ticket Time Disputes — History</h3>
        {historyTicketTimeDisputes.length === 0 ? (
          <p className="text-sm text-slate-400">No resolved ticket time disputes yet.</p>
        ) : (
          <div className="space-y-3">
            {historyTicketTimeDisputes.map((r) => (
              <div key={r.id} className="border border-white/10 rounded-lg p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">{profileName(r.profileId)}</p>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${r.status === "approved" ? "text-emerald-300 border-emerald-400/40 bg-emerald-500/10" : "text-red-300 border-red-400/40 bg-red-500/10"}`}>
                    {r.status === "approved" ? "Approved" : "Rejected"}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Submitted: {r.createdAt.slice(0, 10)}{r.reviewedAt ? ` · Reviewed: ${r.reviewedAt.slice(0, 10)}` : ""}
                </p>
                {r.ticketNo && (
                  <p className="text-sm mt-2">
                    Ticket:{" "}
                    <a href={`/ticket/${r.ticketNo}`} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:text-blue-200 hover:underline font-semibold">
                      {r.ticketNo}
                    </a>
                  </p>
                )}
                {(r.disputedStartTime || r.disputedEndTime) && (
                  <p className="text-sm text-slate-300 mt-1">
                    Claimed time:{" "}
                    <span className="font-semibold text-white">
                      {fmtTimeInZone(r.disputedStartTime, profileTimezone(r.profileId))}
                      {" – "}
                      {fmtTimeInZone(r.disputedEndTime, profileTimezone(r.profileId))}
                      {" "}{profileTimezone(r.profileId)}
                    </span>
                  </p>
                )}
                <p className="text-sm text-slate-300 mt-2">{r.details}</p>
                {r.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {r.attachments.map((a) => (
                      <button
                        key={a.url}
                        type="button"
                        onClick={() => setPreviewAttachmentUrl(a.url)}
                        title={a.name}
                        className="block h-12 w-12 overflow-hidden rounded border border-white/10 bg-slate-800 hover:border-blue-500 transition"
                      >
                        {isPdfAttachment(a.url) ? (
                          <span className="flex h-full w-full items-center justify-center text-slate-400">
                            <Paperclip className="h-4 w-4" />
                          </span>
                        ) : (
                          <img src={a.url} alt={a.name} className="h-full w-full object-cover" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {r.reviewNote && (
                  <p className="text-sm text-emerald-300 font-semibold mt-2">Response: {r.reviewNote}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {previewAttachmentUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPreviewAttachmentUrl(null)}>
          <div className="relative max-h-[90vh] max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setPreviewAttachmentUrl(null)}
              className="absolute -top-10 right-0 text-slate-300 hover:text-white"
            >
              <X className="h-6 w-6" />
            </button>
            {isPdfAttachment(previewAttachmentUrl) ? (
              <iframe src={previewAttachmentUrl} title="Attachment" className="w-full h-[80vh] bg-white rounded-lg" />
            ) : (
              <img src={previewAttachmentUrl} alt="Attachment" className="max-h-[85vh] w-full object-contain rounded-lg" />
            )}
            <a
              href={previewAttachmentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-xs text-blue-300 hover:text-blue-200 hover:underline"
            >
              Open in new tab
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
