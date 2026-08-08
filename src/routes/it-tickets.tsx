import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AccountPageShell } from "@/components/AccountPageShell";
import { useAuth } from "@/lib/auth";
import { Send, Paperclip, X } from "lucide-react";
import {
  createItTicket,
  getItTickets,
  type ItTicketRow,
  type ItTicketPriority,
  type ItTicketStatus,
} from "@/lib/supabase/itTickets";
import { getMyFullProfile } from "@/lib/supabase/users";
import { uploadItTicketScreenshot } from "@/lib/firebase/storage";
import { compressImage, validateImageFile } from "@/lib/imageCompression";

export const Route = createFileRoute("/it-tickets")({
  head: () => ({ meta: [{ title: "IT Support — Admin Hub Solutions" }] }),
  component: ItSupportPage,
});

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

function ItSupportPage() {
  const { uid, email, displayName, companyId } = useAuth();
  const [displayNameFromProfile, setDisplayNameFromProfile] = useState<string | null>(null);

  const [ticketForm, setTicketForm] = useState<{ subject: string; description: string; priority: ItTicketPriority }>({
    subject: "",
    description: "",
    priority: "normal",
  });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [myTickets, setMyTickets] = useState<ItTicketRow[]>([]);

  // Optional screenshot showing the error — compressed and uploaded to
  // Firebase Storage under a client-generated placeholder key (there's no
  // ticket row id yet), then the resulting URL is included in the same
  // createItTicket insert. previewUrl is a local object URL, revoked on
  // clear/unmount so it doesn't leak.
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [screenshotPreviewUrl, setScreenshotPreviewUrl] = useState<string | null>(null);
  const [screenshotError, setScreenshotError] = useState("");

  const handleScreenshotChange = (file: File | null) => {
    if (screenshotPreviewUrl) URL.revokeObjectURL(screenshotPreviewUrl);
    if (!file) {
      setScreenshotFile(null);
      setScreenshotPreviewUrl(null);
      return;
    }
    const invalidReason = validateImageFile(file);
    if (invalidReason) {
      setScreenshotError(invalidReason);
      return;
    }
    setScreenshotError("");
    setScreenshotFile(file);
    setScreenshotPreviewUrl(URL.createObjectURL(file));
  };

  // getMyFullProfile just for a reliable display name to stamp on the ticket —
  // useAuth's displayName can lag right after login, so prefer the DB value.
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    getMyFullProfile(uid)
      .then((p) => {
        if (!cancelled && p) setDisplayNameFromProfile(p.displayName);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [uid]);

  // Whatever the caller's own RLS visibility allows — for a regular employee
  // that's just the tickets they themselves submitted (see it_tickets_select
  // policy in migration 0114).
  const loadMyTickets = async () => {
    try {
      const rows = await getItTickets();
      setMyTickets(rows);
    } catch (err) {
      console.error("Failed to load IT tickets:", err);
    }
  };

  useEffect(() => {
    if (!uid) return;
    loadMyTickets();
  }, [uid]);

  const submitTicket = async () => {
    if (!ticketForm.subject.trim() || !ticketForm.description.trim()) {
      setMessage("Please fill in a subject and description.");
      return;
    }
    setSubmitting(true);
    try {
      const createdByName = displayNameFromProfile || displayName || email || "Unknown";
      let screenshotUrl: string | null = null;
      if (screenshotFile && companyId) {
        const compressed = await compressImage(screenshotFile);
        const uploaded = await uploadItTicketScreenshot(companyId, crypto.randomUUID(), compressed.blob, screenshotFile.name);
        screenshotUrl = uploaded.url;
      }
      await createItTicket({
        subject: ticketForm.subject.trim(),
        description: ticketForm.description.trim(),
        priority: ticketForm.priority,
        createdByName,
        screenshotUrl,
      });
      setTicketForm({ subject: "", description: "", priority: "normal" });
      handleScreenshotChange(null);
      setMessage("Ticket submitted.");
      await loadMyTickets();
    } catch (err) {
      setMessage(`Failed to submit: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSubmitting(false);
      setTimeout(() => setMessage(""), 3000);
    }
  };

  return (
    <AccountPageShell title="IT Support" description="Submit an IT ticket and track its status.">
      <section className="panel">
        <h2 className="text-lg font-semibold mb-2">Submit an IT Ticket</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Having a tech problem? Submit a ticket and IT will follow up. You can track its status below.
        </p>
        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-xs text-muted-foreground">Subject</span>
            <input
              className="glass-input"
              type="text"
              placeholder="e.g. Need to reset password"
              value={ticketForm.subject}
              onChange={(e) => setTicketForm({ ...ticketForm, subject: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Priority</span>
            <select
              className="glass-input"
              value={ticketForm.priority}
              onChange={(e) => setTicketForm({ ...ticketForm, priority: e.target.value as ItTicketPriority })}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-xs text-muted-foreground">Description</span>
            <textarea
              className="glass-input min-h-[100px]"
              placeholder="Describe the issue in as much detail as you can..."
              value={ticketForm.description}
              onChange={(e) => setTicketForm({ ...ticketForm, description: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-xs text-muted-foreground">Screenshot (optional)</span>
            {screenshotPreviewUrl ? (
              <div className="flex items-center gap-3">
                <img src={screenshotPreviewUrl} alt="Screenshot preview" className="h-20 w-20 object-cover rounded-lg border border-white/10" />
                <button type="button" className="btn" onClick={() => handleScreenshotChange(null)}>
                  <X className="h-3.5 w-3.5" /> Remove
                </button>
              </div>
            ) : (
              <label className="btn w-fit cursor-pointer">
                <Paperclip className="h-3.5 w-3.5" /> Attach a screenshot
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleScreenshotChange(e.target.files?.[0] || null)}
                />
              </label>
            )}
            {screenshotError && <span className="text-xs text-red-400">{screenshotError}</span>}
          </label>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn btn-primary" onClick={submitTicket} disabled={submitting}>
            <Send className="h-4 w-4" />
            {submitting ? "Submitting…" : "Submit ticket"}
          </button>
          {message && <span className="text-xs text-muted-foreground">{message}</span>}
        </div>
      </section>

      {myTickets.length > 0 && (
        <section className="panel mt-6">
          <h2 className="text-lg font-semibold mb-4">My Tickets</h2>
          <div className="flex flex-col gap-2">
            {myTickets.map((t) => (
              <div key={t.id} className="rounded-lg border border-white/10 bg-slate-800/40 p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm font-medium text-white">{t.subject}</span>
                  <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS_CLASSES[t.status]}`}>
                    {STATUS_LABELS[t.status]}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{t.description}</p>
                {t.screenshotUrl && (
                  <a href={t.screenshotUrl} target="_blank" rel="noopener noreferrer" className="inline-block mt-2">
                    <img src={t.screenshotUrl} alt="Attached screenshot" className="h-16 w-16 object-cover rounded-lg border border-white/10 hover:border-blue-400/50 transition" />
                  </a>
                )}
                {t.resolutionNotes && (
                  <p className="text-xs text-emerald-300/90 mt-2">IT note: {t.resolutionNotes}</p>
                )}
                <p className="text-[10px] text-slate-500 mt-2">
                  Submitted {new Date(t.createdAt).toLocaleString()} · Priority: {t.priority}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </AccountPageShell>
  );
}
