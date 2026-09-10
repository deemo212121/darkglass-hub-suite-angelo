/**
 * Standalone "add your signature" link for the manager/employer half of a
 * two-party HR form — the counterpart to the Fill*Page.tsx pages the
 * employee side already has. Exists because "Send to Manager"/"Send to
 * Employer" (ReportHRDaily.tsx's handleSendToEmployer) reassigns the
 * document's recipientId to a real line manager who is very often NOT
 * ADMIN/HR — the only roles allowed into the HR & Recruitment Dashboard
 * (DASHBOARD_ROLE_GATES["hr-dashboard"]) where that step previously had to
 * happen. That manager's DM link pointed straight at a page they had no
 * access to — confirmed live on 2026-09-10 for three real Branch/Senior
 * Branch Managers, none of them ADMIN or HR, each the recipientId on a
 * "Awaiting Manager Signature" Parts Responsibility form they couldn't
 * open. This page instead authorizes on "are you the document's current
 * recipientId" — the same narrow check the employee-side Fill*Page.tsx
 * pages already use, and exactly what the hr_signable_documents_update RLS
 * policy itself checks first (recipient_id = auth_profile_id(), no role
 * involved) — so nothing here needs a role gate at all.
 *
 * Only handles document types whose employer/manager step is a plain
 * signature with no fields to review (see SUPPORTED_TYPES below) — every
 * one of ReportHRDaily.tsx's own "*EmployerDialog"/"*ManagerDialog"
 * handlers this mirrors. A type not yet wired up here shows a clear
 * fallback message instead of pretending to work.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import {
  getSignableDocument,
  reassignSignableDocument,
  signDocument,
  confirmSignableDocument,
  type SignableDocument,
  type SignableDocumentType,
} from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadPartsResponsibilityForm, refreshStorageAuthToken } from "@/lib/firebase/storage";
import { fillPartsResponsibilityPdf } from "@/lib/partsResponsibilityPdfFill";
import type { PartsResponsibilityFormData } from "@/lib/partsResponsibilityFormTemplate";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";
import { logActivity } from "@/lib/supabase/hrActivityLog";

interface Props {
  docId: string;
}

const TYPE_LABEL: Partial<Record<SignableDocumentType, string>> = {
  parts_responsibility: "Parts Responsibility and Technician Floor Protection Acknowledgment Form",
};

/** Document types this page can complete — see the file header for why only some are here yet. */
const SUPPORTED_TYPES = new Set<SignableDocumentType>(["parts_responsibility"]);

export function ManagerReviewPage({ docId }: Props) {
  const { ready, uid, displayName, role } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const sigPad = useSignaturePad({ width: 440, height: 100 });

  useEffect(() => {
    if (!ready || !uid) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [profileId, document] = await Promise.all([getMyProfileId(uid), getSignableDocument(docId)]);
        if (cancelled) return;
        setMyProfileId(profileId);
        if (!document) {
          setError("This document doesn't exist or has been removed.");
        } else {
          setDoc(document);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load document.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, uid, docId]);

  const isRecipient = !!doc && !!myProfileId && doc.recipientId === myProfileId;
  const isSuperadmin = role === "SUPERSUPERADMIN";
  const isSupportedType = !!doc && SUPPORTED_TYPES.has(doc.documentType);

  const handleSubmit = async () => {
    if (!doc || !myProfileId || doc.documentType !== "parts_responsibility") return;
    if (!sigPad.hasContent()) {
      setError("Please add your signature.");
      return;
    }
    const dataUrl = sigPad.toDataURL();
    if (!dataUrl) {
      setError("Please add your signature.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // Refreshes recipientName to the live displayName and keeps the RLS
      // "recipient_id = auth_profile_id()" path unambiguous — a no-op in
      // the common case (this page is only reachable because that's
      // already true), same claim-pattern ReportHRDaily.tsx's own dialog
      // uses.
      await reassignSignableDocument(doc.id, { recipientId: myProfileId, recipientName: displayName || "Manager" }, "hr_staff");

      const existing = doc.formData as PartsResponsibilityFormData;
      const technicianSigBytes = existing.technicianSignatureDataUrl
        ? new Uint8Array(await (await fetch(existing.technicianSignatureDataUrl)).arrayBuffer())
        : undefined;

      await refreshStorageAuthToken();
      const managerSigBytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
      const signatureUrl = await uploadSignableDocumentSignature(doc.companyId, doc.id, "hr_staff", dataUrl);
      const signedAt = new Date().toISOString();

      const merged: PartsResponsibilityFormData = { ...existing, managerSignatureDataUrl: dataUrl, managerDateSigned: signedAt };

      const pdfBytes = await fillPartsResponsibilityPdf(merged, technicianSigBytes, managerSigBytes);
      const pdfUrl = await uploadPartsResponsibilityForm(doc.companyId, existing.employeeName || "parts-responsibility", new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" }));

      const entry = { name: displayName || "Manager", url: signatureUrl, signedAt };
      await signDocument(doc.id, "hr_staff", entry, pdfUrl, merged as unknown as Record<string, any>);
      await confirmSignableDocument(doc.id, null);

      void logActivity({ action: "parts_responsibility_manager_signed", targetType: "employee", targetLabel: existing.employeeName || "" });
      setDoc({ ...doc, status: "confirmed", pdfUrl, formData: merged as unknown as Record<string, any> });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save signature.");
    } finally {
      setSubmitting(false);
    }
  };

  const employeeName = doc ? ((doc.formData as { employeeName?: string })?.employeeName || doc.recipientName || "—") : "—";
  const label = doc ? (TYPE_LABEL[doc.documentType] ?? doc.documentType) : "";

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-lg mx-auto p-4">
        <Link to="/home" className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 w-fit mb-4">
          <ChevronLeft className="h-3.5 w-3.5" /> Home
        </Link>

        {loading ? (
          <div className="panel p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading document…
          </div>
        ) : error && !doc ? (
          <div className="panel p-6 text-sm text-red-300">{error}</div>
        ) : !doc ? null : !isRecipient && !isSuperadmin ? (
          <div className="panel p-6 text-sm text-muted-foreground">
            This form isn't currently assigned to you for review — it may have already been completed, or sent to someone else. Check with HR if you think this is wrong.
          </div>
        ) : !isSupportedType ? (
          <div className="panel p-6 text-sm text-muted-foreground">
            This form type isn't available through this link yet — please ask HR to complete it from the HR &amp; Recruitment Dashboard.
          </div>
        ) : submitted || doc.status === "confirmed" ? (
          <div className="panel p-6 text-center">
            <p className="text-sm font-semibold mb-2">✓ Signed{submitted ? " and sent back to HR" : ""}.</p>
            {doc.pdfUrl && (
              <a href={doc.pdfUrl} target="_blank" rel="noreferrer noopener" className="text-blue-300 hover:text-blue-200 underline text-sm">
                View the completed PDF
              </a>
            )}
          </div>
        ) : (
          <div className="panel p-4">
            <h1 className="text-lg font-bold mb-2">Add Your Signature</h1>
            <p className="text-sm text-muted-foreground mb-4">
              Manager/supervisor signature for <span className="font-semibold text-foreground">{employeeName}</span>'s {label}.
            </p>

            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Add your signature</label>
            <canvas
              {...sigPad.canvasProps}
              className={`bg-white rounded-md border border-white/15 w-full ${sigPad.canvasProps.className}`}
            />
            <div className="flex justify-center mt-2">
              <SignaturePadControls pad={sigPad} />
            </div>

            {error && (
              <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 mt-3">{error}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white mt-3 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Complete & Sign"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
