/**
 * Sign Document â opened from the deep link a Team Messenger message sends
 * (see ReportHRDaily.tsx's Employee Warning Form "Send for Signature"
 * flow). The recipient previews the exact document, draws their signature,
 * and confirming re-flattens the same template with that signature
 * composited into their line, then sends the finished PDF straight back to
 * whoever generated it â a single round-trip, no further routing.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { getSignableDocument, signDocument, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadWarningForm, refreshStorageAuthToken } from "@/lib/firebase/storage";
import { captureHtmlToPdfBlob, loadAssetDataUrl } from "@/lib/pdfCapture";
import { buildWarningFormBodyMarkup, warningFormStyles, type WarningFormData } from "@/lib/warningFormTemplate";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { getHrNotificationSettings } from "@/lib/supabase/companySettings";
import { notifyHrRoleUsers } from "@/lib/supabase/hrRoleNotify";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";

interface Props {
  docId: string;
}

const SLOT_LABEL: Record<string, string> = {
  employee: "Employee",
  manager: "Manager",
  senior_manager: "Senior Manager",
  hr_staff: "HR Staff",
};

export function SignDocumentPage({ docId }: Props) {
  const { ready, uid, displayName, role } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SignableDocument | null>(null);
  const [logoDataUrl, setLogoDataUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);

  const sigPad = useSignaturePad({ width: 500, height: 150 });

  useEffect(() => {
    if (!ready || !uid) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [profileId, logo, document] = await Promise.all([
          getMyProfileId(uid),
          loadAssetDataUrl(() => import("@/assets/us-in-home-services-logo.png")),
          getSignableDocument(docId),
        ]);
        if (cancelled) return;
        setMyProfileId(profileId);
        setLogoDataUrl(logo);
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

  const handleConfirmSign = async () => {
    if (!doc || !myProfileId) return;
    if (!sigPad.hasContent()) {
      setError("Please add your signature first.");
      return;
    }
    const dataUrl = sigPad.toDataURL();
    if (!dataUrl) {
      setError("Please add your signature first.");
      return;
    }
    setSigning(true);
    setError(null);
    try {
      const companyId = doc.companyId;
      // Force a fresh ID token before this upload sequence — see
      // refreshStorageAuthToken's doc comment (a slow connection can let
      // it go stale between signing in and finally submitting).
      await refreshStorageAuthToken();
      const signatureUrl = await uploadSignableDocumentSignature(companyId, doc.id, doc.recipientSlot, dataUrl);
      const entry = { name: displayName || "Signed", url: signatureUrl, signedAt: new Date().toISOString() };

      const formData = doc.formData as unknown as WarningFormData;
      // Persisted signatures (DB + any future re-render) use the durable
      // Firebase URL, but for THIS capture we use the local canvas data:
      // URL instead â Firebase Storage doesn't serve CORS headers by
      // default, so html2canvas can read pixels from a data: URL (always
      // same-origin-safe) but silently fails to draw a cross-origin
      // firebasestorage.googleapis.com URL, leaving that signature blank.
      const signatures = { ...doc.signatures, [doc.recipientSlot]: entry };
      const captureSignatures = { ...doc.signatures, [doc.recipientSlot]: { ...entry, url: dataUrl } };
      const pdfBlob = await captureHtmlToPdfBlob(buildWarningFormBodyMarkup(formData, logoDataUrl, captureSignatures), warningFormStyles);
      const pdfUrl = await uploadWarningForm(companyId, formData.employeeName, pdfBlob);

      await signDocument(doc.id, doc.recipientSlot, entry, pdfUrl);

      if (doc.createdBy) {
        const thread = await getOrCreateDmThread(myProfileId, doc.createdBy);
        const filename = `Signed Employee Warning Form - ${formData.employeeName}.pdf`;
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || "Employee",
          body: `â Employee Warning Form for ${formData.employeeName} has been signed: [${filename}](${pdfUrl})`,
        });
      }

      // Opt-in broadcast â see Notifications Settings (migration 0090).
      getHrNotificationSettings()
        .then(({ warningForm }) => {
          if (!warningForm) return;
          const excludeIds = doc.createdBy ? [doc.createdBy] : [];
          void notifyHrRoleUsers(myProfileId, displayName || "Employee", excludeIds, `â Employee Warning Form for ${formData.employeeName} has been signed.`);
        })
        .catch((err) => console.error("[warning-form] hr notify check failed:", err));

      // Reflect the freshly-regenerated PDF/signature locally â `doc` was
      // loaded before signing, so its pdfUrl/signatures are the pre-sign
      // snapshot (this is what made "View the signed PDF" show a blank
      // signature line right after signing).
      setDoc({ ...doc, status: "signed", pdfUrl, signatures, signedAt: entry.signedAt });
      void logActivity({ action: "warning_form_signed", targetType: "employee", targetLabel: formData.employeeName, details: { slot: doc.recipientSlot } });
      setSigned(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit signature.");
    } finally {
      setSigning(false);
    }
  };

  const isRecipient = !!doc && !!myProfileId && doc.recipientId === myProfileId;
  // Platform-level SUPERSUPERADMIN only â the per-company SUPERADMIN role
  // should NOT see every employee's private documents, just its own like ADMIN.
  const isSuperadmin = role === "SUPERSUPERADMIN";

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-3xl mx-auto p-4">
        <Link to="/home" className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 w-fit mb-4">
          <ChevronLeft className="h-3.5 w-3.5" /> Home
        </Link>

        {loading ? (
          <div className="panel p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading documentâ¦
          </div>
        ) : error && !doc ? (
          <div className="panel p-6 text-sm text-red-300">{error}</div>
        ) : !doc ? null : !isRecipient && !isSuperadmin ? (
          <div className="panel p-6 text-sm text-muted-foreground">This document isn't addressed to your account.</div>
        ) : signed || doc.status === "signed" ? (
          <div className="panel p-6 text-center">
            <p className="text-sm font-semibold mb-2">â Signed{signed ? " and sent back to HR" : ""}.</p>
            {doc.pdfUrl && (
              <a href={doc.pdfUrl} target="_blank" rel="noreferrer noopener" className="text-blue-300 hover:text-blue-200 underline text-sm">
                View the signed PDF
              </a>
            )}
          </div>
        ) : (
          <div className="panel p-0 overflow-hidden">
            <div className="px-4 py-4 border-b border-white/10">
              <h2 className="font-semibold text-sm">Employee Warning Form â Signature Requested</h2>
              <p className="text-[10px] text-muted-foreground mt-0.5">Review the form below, then sign as {SLOT_LABEL[doc.recipientSlot] ?? doc.recipientSlot}.</p>
            </div>

            <div className="overflow-x-auto bg-white/5 p-4 flex justify-center">
              <div style={{ transform: "scale(0.78)", transformOrigin: "top center" }}>
                <style dangerouslySetInnerHTML={{ __html: warningFormStyles }} />
                <div dangerouslySetInnerHTML={{ __html: buildWarningFormBodyMarkup(doc.formData as unknown as WarningFormData, logoDataUrl, doc.signatures) }} />
              </div>
            </div>

            <div className="p-4 border-t border-white/10">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Signature</label>
              <canvas
                {...sigPad.canvasProps}
                className={`bg-white rounded-md border border-white/15 w-full max-w-md ${sigPad.canvasProps.className}`}
              />
              <div className="mt-2">
                <SignaturePadControls pad={sigPad} />
              </div>

              {error && (
                <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 mt-3">{error}</p>
              )}

              <button
                onClick={handleConfirmSign}
                disabled={signing}
                className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white mt-3 disabled:opacity-50"
              >
                {signing ? "Submittingâ¦" : "Confirm & Sign"}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
