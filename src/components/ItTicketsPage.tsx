import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Ticket, Trash2, Save, Send, Mail } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { getMyRoles, getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";
import { hasDashboardAccess } from "@/lib/dashboardAccess";
import { ActivityLogPanel } from "@/components/ActivityLogPanel";
import { logModuleActivity } from "@/lib/supabase/moduleActivityLog";
import {
  getItTickets,
  updateItTicket,
  deleteItTicket,
  notifyTicketStatusChange,
  type ItTicketRow,
  type ItTicketPriority,
  type ItTicketStatus,
} from "@/lib/supabase/itTickets";
import {
  getGmailConnectionStatus,
  disconnectGmail,
  IT_TICKET_GMAIL_REGIONS,
  type GmailConnectionStatus,
  type GmailRegion,
} from "@/lib/supabase/gmailConnection";
import { auth as firebaseAuth } from "@/lib/firebase/config";

const IT_ADMIN_ROLES = ["IT", "ADMIN"];
const IT_GMAIL_LABELS: Record<string, string> = { IT_1: "Slot 1", IT_2: "Slot 2", IT_3: "Slot 3" };
const CC_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STATUS_LABELS: Record<ItTicketStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

const STATUS_CLASSES: Record<ItTicketStatus, string> = {
  open: "bg-blue-500/20 text-blue-300",
  in_progress: "bg-amber-500/20 text-amber-300",
  resolved: "bg-emerald-500/20 text-emerald-300",
  closed: "bg-slate-500/20 text-slate-300",
};

const PRIORITY_CLASSES: Record<ItTicketPriority, string> = {
  low: "bg-slate-500/20 text-slate-300",
  normal: "bg-blue-500/20 text-blue-300",
  high: "bg-orange-500/20 text-orange-300",
  urgent: "bg-red-500/20 text-red-300",
};

export function ItTicketsPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const { uid, role, displayName, email } = useAuth();
  const [extraRoles, setExtraRoles] = useState<string[] | null>(null);
  // IT/Admin/Superadmin get full edit/assign/delete — everyone else who made
  // it past the page-level gate (Senior Managers) is read-only. Enforced
  // again server-side by the it_tickets_update/delete RLS policies either way.
  const canEdit = extraRoles !== null && hasDashboardAccess(IT_ADMIN_ROLES, role, extraRoles);

  const [tickets, setTickets] = useState<ItTicketRow[]>([]);
  const [itAdmins, setItAdmins] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [statusFilter, setStatusFilter] = useState<ItTicketStatus | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<ItTicketPriority | "all">("all");
  const [search, setSearch] = useState("");

  const [selected, setSelected] = useState<ItTicketRow | null>(null);
  const [editStatus, setEditStatus] = useState<ItTicketStatus>("open");
  const [editAssignedTo, setEditAssignedTo] = useState<string>("");
  const [editResolutionNotes, setEditResolutionNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Up to 3 independently-connectable Gmail accounts for IT Tickets (see
  // migration 0173) — unlike Payroll/Parts, the "Send" preview lets the
  // caller pick WHICH connected one to send from, rather than always
  // resolving to a single fixed slot.
  const [gmailStatuses, setGmailStatuses] = useState<Record<string, GmailConnectionStatus | null>>({});
  const [gmailStatusLoading, setGmailStatusLoading] = useState(false);
  const [connectingRegion, setConnectingRegion] = useState<GmailRegion | null>(null);
  const [disconnectingRegion, setDisconnectingRegion] = useState<GmailRegion | null>(null);

  const loadGmailStatuses = () => {
    setGmailStatusLoading(true);
    Promise.all(IT_TICKET_GMAIL_REGIONS.map((region) => getGmailConnectionStatus(region)))
      .then((results) => {
        const next: Record<string, GmailConnectionStatus | null> = {};
        IT_TICKET_GMAIL_REGIONS.forEach((region, i) => { next[region] = results[i]; });
        setGmailStatuses(next);
      })
      .catch((err) => console.error("Failed to load IT Gmail connection status:", err))
      .finally(() => setGmailStatusLoading(false));
  };

  const handleConnectGmail = async (region: GmailRegion) => {
    setConnectingRegion(region);
    try {
      const idToken = await firebaseAuth?.currentUser?.getIdToken();
      if (!idToken) throw new Error("Could not verify your session. Please re-login and try again.");
      window.location.href = `/api/gmail?action=connect&region=${region}&idToken=${encodeURIComponent(idToken)}`;
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to start Gmail connection.");
      setConnectingRegion(null);
    }
  };

  const handleDisconnectGmail = async (region: GmailRegion) => {
    const email = gmailStatuses[region]?.connectedEmail;
    if (!confirm(`Disconnect ${email || "this"} Gmail account from IT Tickets ${IT_GMAIL_LABELS[region] || region}?`)) return;
    setDisconnectingRegion(region);
    try {
      await disconnectGmail(region);
      loadGmailStatuses();
    } catch (err) {
      alert(`Failed to disconnect: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setDisconnectingRegion(null);
    }
  };

  // "Send" preview modal — a free-text email the caller composes/edits
  // before sending, same pattern as ticket.$ticketNo.tsx's Drop-Ship
  // Request preview.
  const [sendTicket, setSendTicket] = useState<ItTicketRow | null>(null);
  const [sendFromRegion, setSendFromRegion] = useState<GmailRegion | "">("");
  const [sendTo, setSendTo] = useState("");
  const [sendCc, setSendCc] = useState<string[]>([]);
  const [sendCcInput, setSendCcInput] = useState("");
  const [sendSubject, setSendSubject] = useState("");
  const [sendBody, setSendBody] = useState("");
  const [sendSending, setSendSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSent, setSendSent] = useState(false);

  const connectedItRegions = IT_TICKET_GMAIL_REGIONS.filter((r) => gmailStatuses[r]?.connected);

  const openSendModal = (t: ItTicketRow) => {
    setSendTicket(t);
    setSendFromRegion(connectedItRegions[0] || "");
    setSendTo("");
    setSendCc([]);
    setSendCcInput("");
    setSendError(null);
    setSendSent(false);
    setSendSubject(`Re: ${t.subject}`);
    setSendBody(
      [
        "Hi,",
        "",
        `Regarding your IT ticket "${t.subject}":`,
        "",
        "",
        "",
        "Thank you,",
        displayName || "IT",
      ].join("\n"),
    );
  };
  const closeSendModal = () => setSendTicket(null);

  const commitSendCcInput = () => {
    const parts = sendCcInput.split(/[,;\s]+/).map((p) => p.trim()).filter((p) => p.length > 0);
    if (parts.length === 0) return;
    const valid = parts.filter((p) => CC_EMAIL_RE.test(p));
    const invalid = parts.filter((p) => !CC_EMAIL_RE.test(p));
    if (valid.length > 0) setSendCc((prev) => [...prev, ...valid.filter((p) => !prev.includes(p))]);
    setSendCcInput(invalid.join(", "));
    if (invalid.length === 0) setSendError(null);
  };
  const removeSendCc = (email: string) => setSendCc((prev) => prev.filter((e) => e !== email));

  const handleSendTicketEmail = async () => {
    if (!sendTicket) return;
    const to = sendTo.trim();
    if (!sendFromRegion) {
      setSendError("Pick which connected Gmail account to send from.");
      return;
    }
    if (!to) {
      setSendError("Recipient email is required.");
      return;
    }
    const pendingCc = sendCcInput.split(/[,;\s]+/).map((p) => p.trim()).filter((p) => p.length > 0);
    if (pendingCc.some((p) => !CC_EMAIL_RE.test(p))) {
      setSendError(`Invalid CC email address: ${pendingCc.find((p) => !CC_EMAIL_RE.test(p))}`);
      return;
    }
    const ccList = [...sendCc, ...pendingCc.filter((p) => !sendCc.includes(p))];
    setSendSending(true);
    setSendError(null);
    try {
      const idToken = await firebaseAuth?.currentUser?.getIdToken();
      if (!idToken) throw new Error("Could not verify your session. Please re-login and try again.");
      const res = await fetch("/api/gmail?action=send-it-ticket-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, region: sendFromRegion, to, cc: ccList.join(", "), subject: sendSubject, body: sendBody }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to send.");
      setSendCc(ccList);
      setSendCcInput("");
      setSendSent(true);
      void logModuleActivity({
        module: "it-tickets",
        actorName: displayName || email || "IT",
        action: "it_ticket_email_sent",
        targetType: "it_ticket",
        targetId: sendTicket.id,
        targetLabel: sendTicket.subject,
        details: { to, cc: ccList.join(", ") },
      });
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send.");
    } finally {
      setSendSending(false);
    }
  };

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    getMyRoles(uid).then(({ extraRoles }) => {
      if (!cancelled) setExtraRoles(extraRoles);
    });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const loadTickets = async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await getItTickets();
      setTickets(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tickets.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTickets();
  }, []);

  // Only needed for the Assign dropdown, and only IT/Admin can assign anyway.
  useEffect(() => {
    if (!canEdit) return;
    getCompanyUsers()
      .then((users) =>
        setItAdmins(
          users.filter((u) => hasDashboardAccess(IT_ADMIN_ROLES, u.role, u.extra_roles))
        )
      )
      .catch((err) => console.error("Failed to load IT/Admin roster:", err));
  }, [canEdit]);

  useEffect(() => {
    if (!canEdit) return;
    loadGmailStatuses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);

  const filteredTickets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
      if (q && !`${t.subject} ${t.description} ${t.createdByName}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tickets, statusFilter, priorityFilter, search]);

  const openTicket = (t: ItTicketRow) => {
    setSelected(t);
    setEditStatus(t.status);
    setEditAssignedTo(t.assignedTo || "");
    setEditResolutionNotes(t.resolutionNotes || "");
  };

  const closeModal = () => {
    setSelected(null);
    setSaving(false);
  };

  const saveTicket = async () => {
    if (!selected || !canEdit) return;
    setSaving(true);
    try {
      const assignedProfile = itAdmins.find((u) => u.id === editAssignedTo) || null;
      const statusChanged = editStatus !== selected.status;
      await updateItTicket(selected.id, {
        status: editStatus,
        assignedTo: editAssignedTo || null,
        assignedToName: assignedProfile ? assignedProfile.display_name : null,
        resolutionNotes: editResolutionNotes.trim() ? editResolutionNotes.trim() : null,
      });
      // Best-effort — the submitter's bell notification should never block
      // the save itself if it fails.
      if (statusChanged) {
        notifyTicketStatusChange(selected, editStatus, displayName || email || "IT").catch((err) =>
          console.error("Failed to notify ticket submitter:", err)
        );
        void logModuleActivity({
          module: "it-tickets",
          actorName: displayName || email || "IT",
          action: "it_ticket_status_changed",
          targetType: "it_ticket",
          targetId: selected.id,
          targetLabel: selected.subject,
          details: { from: selected.status, to: editStatus },
        });
      }
      closeModal();
      await loadTickets();
    } catch (err) {
      alert(`Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
      setSaving(false);
    }
  };

  const removeTicket = async (t: ItTicketRow) => {
    if (!canEdit) return;
    if (!confirm(`Delete ticket "${t.subject}"? This cannot be undone.`)) return;
    try {
      await deleteItTicket(t.id);
      void logModuleActivity({
        module: "it-tickets",
        actorName: displayName || email || "IT",
        action: "it_ticket_deleted",
        targetType: "it_ticket",
        targetId: t.id,
        targetLabel: t.subject,
      });
      if (selected?.id === t.id) closeModal();
      await loadTickets();
    } catch (err) {
      alert(`Failed to delete: ${err instanceof Error ? err.message : "Unknown error"}`);
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
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
                {sub.title}
              </h1>
              <p className="text-sm text-muted-foreground">{sub.description}</p>
              {extraRoles !== null && !canEdit && (
                <p className="mt-2 text-xs text-amber-300/90">
                  View-only — only IT and Admins can edit, assign, or delete tickets.
                </p>
              )}
            </div>

            {canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <Mail className="h-3 w-3" /> Send from
                </span>
                {IT_TICKET_GMAIL_REGIONS.map((region) => {
                  const status = gmailStatuses[region];
                  if (gmailStatusLoading && !status) {
                    return <span key={region} className="text-[10px] text-slate-500">{IT_GMAIL_LABELS[region]}…</span>;
                  }
                  if (status?.connected) {
                    return (
                      <span
                        key={region}
                        className="flex items-center gap-1 rounded border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-300"
                        title={`${IT_GMAIL_LABELS[region]}: ${status.connectedEmail}`}
                      >
                        ✓ {IT_GMAIL_LABELS[region]}: {status.connectedEmail}
                        <button
                          type="button"
                          onClick={() => void handleDisconnectGmail(region)}
                          disabled={disconnectingRegion === region}
                          className="ml-1 text-emerald-400/70 hover:text-emerald-200 disabled:opacity-50"
                          title={`Disconnect ${IT_GMAIL_LABELS[region]}`}
                        >
                          ×
                        </button>
                      </span>
                    );
                  }
                  return (
                    <button
                      key={region}
                      type="button"
                      onClick={() => void handleConnectGmail(region)}
                      disabled={connectingRegion === region}
                      className="rounded border border-white/15 bg-slate-800 px-2 py-1 text-[10px] font-semibold text-slate-300 transition hover:bg-slate-700 disabled:opacity-50"
                      title={`Connect a Gmail account as ${IT_GMAIL_LABELS[region]}`}
                    >
                      {connectingRegion === region ? "Connecting…" : `Connect ${IT_GMAIL_LABELS[region]}`}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="mb-4">
          <ActivityLogPanel module="it-tickets" title="IT Tickets Activity Log" />
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input
            type="text"
            placeholder="Search subject, description, submitter…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 min-w-[240px]"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ItTicketStatus | "all")}
            className="px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="all">All statuses</option>
            {(Object.keys(STATUS_LABELS) as ItTicketStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as ItTicketPriority | "all")}
            className="px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="all">All priorities</option>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
          <span className="text-xs text-slate-500">{filteredTickets.length} ticket{filteredTickets.length === 1 ? "" : "s"}</span>
        </div>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        <div className="bg-slate-900/50 border border-white/10 rounded-lg overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Subject</th>
                <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Submitted By</th>
                <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Priority</th>
                <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Assigned To</th>
                <th className="px-4 py-3 text-left text-xs text-slate-400 uppercase">Submitted</th>
                <th className="px-4 py-3 text-right text-xs text-slate-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">
                    Loading…
                  </td>
                </tr>
              ) : filteredTickets.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">
                    No tickets found.
                  </td>
                </tr>
              ) : (
                filteredTickets.map((t) => (
                  <tr key={t.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-3 font-medium">
                      <button
                        type="button"
                        onClick={() => openTicket(t)}
                        className="text-blue-400 hover:text-blue-300 hover:underline text-left"
                      >
                        {t.subject}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{t.createdByName}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${PRIORITY_CLASSES[t.priority]}`}>
                        {t.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS_CLASSES[t.status]}`}>
                        {STATUS_LABELS[t.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{t.assignedToName || "—"}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{new Date(t.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openTicket(t)}
                          className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-medium transition"
                        >
                          {canEdit ? "Manage" : "View"}
                        </button>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => openSendModal(t)}
                            title="Email this ticket's submitter (or anyone else)"
                            className="px-2.5 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-400/30 text-blue-300 rounded text-xs font-medium transition inline-flex items-center gap-1"
                          >
                            <Send className="h-3 w-3" /> Send
                          </button>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => removeTicket(t)}
                            title="Delete ticket"
                            className="p-1.5 bg-slate-700 hover:bg-red-600 text-white rounded transition"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>

      {selected && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-lg w-full max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Ticket className="h-4 w-4 text-blue-400" /> {selected.subject}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Submitted by {selected.createdByName} on {new Date(selected.createdAt).toLocaleString()}
                </p>
              </div>
              <button onClick={closeModal} className="text-slate-400 hover:text-white transition p-1">✕</button>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Description</label>
              <p className="text-sm text-slate-200 whitespace-pre-wrap bg-slate-800/50 border border-white/10 rounded-lg p-3">
                {selected.description}
              </p>
            </div>

            {selected.screenshotUrl && (
              <div className="mb-4">
                <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Screenshot</label>
                <a href={selected.screenshotUrl} target="_blank" rel="noopener noreferrer">
                  <img
                    src={selected.screenshotUrl}
                    alt="Attached screenshot"
                    className="max-h-64 rounded-lg border border-white/10 hover:border-blue-400/50 transition"
                  />
                </a>
              </div>
            )}

            {!canEdit ? (
              <>
                <div className="grid grid-cols-2 gap-3 mb-2">
                  <div>
                    <span className="block text-xs font-semibold text-slate-400 uppercase mb-1">Priority</span>
                    <span className={`inline-block text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${PRIORITY_CLASSES[selected.priority]}`}>
                      {selected.priority}
                    </span>
                  </div>
                  <div>
                    <span className="block text-xs font-semibold text-slate-400 uppercase mb-1">Status</span>
                    <span className={`inline-block text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS_CLASSES[selected.status]}`}>
                      {STATUS_LABELS[selected.status]}
                    </span>
                  </div>
                </div>
                {selected.assignedToName && (
                  <p className="text-xs text-slate-400 mb-2">Assigned to: {selected.assignedToName}</p>
                )}
                {selected.resolutionNotes && (
                  <div className="mb-2">
                    <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">IT Notes</label>
                    <p className="text-sm text-emerald-300/90 whitespace-pre-wrap">{selected.resolutionNotes}</p>
                  </div>
                )}
                <button onClick={closeModal} className="w-full mt-4 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm">
                  Close
                </button>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs text-slate-400">Status</span>
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value as ItTicketStatus)}
                      className="px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                    >
                      {(Object.keys(STATUS_LABELS) as ItTicketStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs text-slate-400">Assign to</span>
                    <select
                      value={editAssignedTo}
                      onChange={(e) => setEditAssignedTo(e.target.value)}
                      className="px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                    >
                      <option value="">Unassigned</option>
                      {itAdmins.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.display_name || u.email}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="mb-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs text-slate-400">Resolution / IT notes</span>
                    <textarea
                      value={editResolutionNotes}
                      onChange={(e) => setEditResolutionNotes(e.target.value)}
                      rows={4}
                      placeholder="What was done to resolve this..."
                      className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-3 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none resize-none"
                    />
                  </label>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={saveTicket}
                    disabled={saving}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition font-semibold text-sm"
                  >
                    <Save className="h-4 w-4" />
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={() => removeTicket(selected)}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-red-600/80 hover:bg-red-600 text-white rounded-lg transition font-semibold text-sm"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                  <button onClick={closeModal} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm">
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {sendTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={closeSendModal}>
          <div className="w-full max-w-lg rounded-lg border border-white/10 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-lg font-bold text-white">Send Email</h3>
            <p className="mb-4 text-xs text-slate-400">Re: {sendTicket.subject}</p>

            {sendSent ? (
              <>
                <p className="mb-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-300">
                  Sent to {sendTo}{sendCc.length > 0 ? ` (cc: ${sendCc.join(", ")})` : ""}.
                </p>
                <div className="flex justify-end">
                  <button type="button" onClick={closeSendModal} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Sender</label>
                    <select
                      value={sendFromRegion}
                      onChange={(e) => setSendFromRegion(e.target.value as GmailRegion)}
                      className="mt-1 w-full rounded-md border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">— Select a connected Gmail account —</option>
                      {connectedItRegions.map((region) => (
                        <option key={region} value={region}>
                          {IT_GMAIL_LABELS[region]}: {gmailStatuses[region]?.connectedEmail}
                        </option>
                      ))}
                    </select>
                    {connectedItRegions.length === 0 && (
                      <p className="mt-1 text-[11px] text-amber-400">No Gmail account connected yet — connect one at the top of this page first.</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Recipient</label>
                    <input
                      type="email"
                      value={sendTo}
                      onChange={(e) => setSendTo(e.target.value)}
                      placeholder="person@example.com"
                      className="mt-1 w-full rounded-md border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">CC (optional)</label>
                    <div className="mt-1 flex w-full flex-wrap items-center gap-1.5 rounded-md border border-white/15 bg-slate-950 px-2 py-1.5 focus-within:border-blue-500">
                      {sendCc.map((cc) => (
                        <span key={cc} className="flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-xs text-white">
                          {cc}
                          <button type="button" onClick={() => removeSendCc(cc)} className="text-slate-400 hover:text-white" aria-label={`Remove ${cc}`}>
                            ×
                          </button>
                        </span>
                      ))}
                      <input
                        type="text"
                        value={sendCcInput}
                        onChange={(e) => setSendCcInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === ",") {
                            e.preventDefault();
                            commitSendCcInput();
                          } else if (e.key === "Backspace" && sendCcInput === "" && sendCc.length > 0) {
                            removeSendCc(sendCc[sendCc.length - 1]);
                          }
                        }}
                        onBlur={commitSendCcInput}
                        placeholder={sendCc.length > 0 ? "Add another…" : "you@company.com"}
                        className="min-w-[10rem] flex-1 bg-transparent px-1 py-0.5 text-sm text-white focus:outline-none"
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">Press Enter after each address to add it.</p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Subject</label>
                    <input
                      type="text"
                      value={sendSubject}
                      onChange={(e) => setSendSubject(e.target.value)}
                      className="mt-1 w-full rounded-md border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Message (preview — edit before sending)</label>
                    <textarea
                      value={sendBody}
                      onChange={(e) => setSendBody(e.target.value)}
                      rows={10}
                      className="mt-1 w-full rounded-md border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none resize-none"
                    />
                  </div>
                  {sendError && (
                    <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{sendError}</p>
                  )}
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={closeSendModal} className="rounded-md border border-white/15 px-4 py-2 text-sm text-slate-300 hover:bg-white/5">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSendTicketEmail}
                    disabled={sendSending || !sendTo.trim() || !sendFromRegion}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    {sendSending ? "Sending…" : "Send"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
