/**
 * Sign Promotion Paper and Wage Increase — opened from the DM link each
 * signer receives. After signing, the document is handed straight to the
 * next signer (Senior → Executive → HR → Employee) by /api/compensation-update,
 * and that signer gets their own DM with the link. The employee signs last, which
 * finalizes it and sends the finished PDF back to whoever created it.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { auth as firebaseAuth } from "@/lib/firebase/config";
import { FillFormSignInRequired } from "@/components/FillFormSignInRequired";
import { getMyProfileId } from "@/lib/supabase/users";
import { getSignableDocument, signDocument, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadCompensationUpdate, refreshStorageAuthToken } from "@/lib/firebase/storage";
import { captureHtmlToPdfBlob, loadAssetDataUrl, resolveSignaturesForCapture } from "@/lib/pdfCapture";
import {
  buildCompensationUpdateBodyMarkup,
  compensationUpdateStyles,
  COMPENSATION_SLOT_LABEL,
  compensationSignRequestMessage,
  type CompensationSignatureSlot,
  type CompensationUpdateFormData,
} from "@/lib/compensationUpdateTemplate";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { getAppUrl } from "@/lib/appUrl";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";

interface Props {
  docId: string;
}

type SignOutcome = { kind: "next"; nextName: string; nextSlot: CompensationSignatureSlot } | { kind: "done" };

export function SignCompensationUpdatePage({ docId }: Props) {
  const { ready, uid, displayName, role } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SignableDocument | null>(null);
  const [logoDataUrl, setLogoDataUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [outcome, setOutcome] = useState<SignOutcome | null>(null);

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
        if (!document) setError("This document doesn't exist or has been removed.");
        else setDoc(document);
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
    const dataUrl = sigPad.hasContent() ? sigPad.toDataURL() : "";
    if (!dataUrl) {
      setError("Please add your signature first.");
      return;
    }
    setSigning(true);
    setError(null);
    try {
      const companyId = doc.companyId;
      const slot = doc.recipientSlot as CompensationSignatureSlot;
      await refreshStorageAuthToken();
      const signatureUrl = await uploadSignableDocumentSignature(companyId, doc.id, slot, dataUrl);
      const entry = { name: displayName || "Signed", url: signatureUrl, signedAt: new Date().toISOString() };

      const formData = doc.formData as unknown as CompensationUpdateFormData;
      const signatures = { ...doc.signatures, [slot]: entry };
      // Every signature as a local data: URL for capture — a Firebase URL
      // alone fails to draw into the PDF (see resolveSignaturesForCapture).
      const captureSignatures = await resolveSignaturesForCapture(signatures, slot, dataUrl);
      const pdfBlob = await captureHtmlToPdfBlob(buildCompensationUpdateBodyMarkup(formData, logoDataUrl, captureSignatures), compensationUpdateStyles);
      const pdfUrl = await uploadCompensationUpdate(companyId, formData.employeeName, pdfBlob);

      await signDocument(doc.id, slot, entry, pdfUrl);

      // Hand it to the next signer (or finalize after the employee) — done server-side,
      // since a signer can't reassign a document away from themselves.
      const idToken = await firebaseAuth?.currentUser?.getIdToken(false);
      if (!idToken) throw new Error("Your session expired — sign in again. Your signature was saved.");
      const res = await fetch("/api/compensation-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, docId: doc.id }),
      });
      const result = (await res.json().catch(() => ({}))) as { done?: boolean; next?: { slot: CompensationSignatureSlot; id: string | null; name: string }; error?: string };
      if (!res.ok) throw new Error(`Your signature was saved, but the document couldn't move to the next signer: ${result.error || res.status}. HR can send it on from the Promotion Paper and Wage Increase tab.`);

      const filename = `Promotion Paper and Wage Increase - ${formData.employeeName}.pdf`;
      if (result.next && !result.next.id) {
        // HR step has no single recipient — let whoever issued it know it's ready to sign in HR Paperworks.
        if (doc.createdBy && doc.createdBy !== myProfileId) {
          const thread = await getOrCreateDmThread(myProfileId, doc.createdBy);
          await sendMessage({
            dmThreadId: thread.id,
            senderId: myProfileId,
            senderName: displayName || "AHS",
            body: `📝 Promotion Paper and Wage Increase for ${formData.employeeName} is ready for the HR signature. Sign it from HR Paperworks → Promotion Paper and Wage Increase: ${getAppUrl()}/m/hr/hr-paperworks?tab=compensationUpdate`,
          });
        }
        setOutcome({ kind: "next", nextName: "HR", nextSlot: result.next.slot });
      } else if (result.next?.id) {
        const thread = await getOrCreateDmThread(myProfileId, result.next.id);
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || "AHS",
          body: compensationSignRequestMessage(result.next.slot, formData.employeeName, `${getAppUrl()}/sign-compensation-update/${doc.id}`),
        });
        setOutcome({ kind: "next", nextName: result.next.name, nextSlot: result.next.slot });
      } else {
        if (doc.createdBy && doc.createdBy !== myProfileId) {
          const thread = await getOrCreateDmThread(myProfileId, doc.createdBy);
          await sendMessage({
            dmThreadId: thread.id,
            senderId: myProfileId,
            senderName: displayName || "HR",
            body: `✅ Promotion Paper and Wage Increase for ${formData.employeeName} is fully signed: [${filename}](${pdfUrl})`,
          });
        }
        setOutcome({ kind: "done" });
      }

      setDoc({ ...doc, status: result.next ? "pending_signature" : "confirmed", pdfUrl, signatures, signedAt: entry.signedAt });
      void logActivity({ action: "compensation_update_signed", targetType: "employee", targetId: formData.employeeId, targetLabel: formData.employeeName, details: { slot, next: result.next?.slot ?? null } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit signature.");
    } finally {
      setSigning(false);
    }
  };

  const isRecipient = !!doc && !!myProfileId && doc.recipientId === myProfileId;
  const isSuperadmin = role === "SUPERSUPERADMIN";
  const alreadyDone = !!doc && (doc.status === "confirmed" || (doc.status === "signed" && !outcome));

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-3xl mx-auto p-4">
        <Link to="/home" className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 w-fit mb-4">
          <ChevronLeft className="h-3.5 w-3.5" /> Home
        </Link>

        {ready && !uid ? (
          <FillFormSignInRequired />
        ) : loading ? (
          <div className="panel p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading document…
          </div>
        ) : error && !doc ? (
          <div className="panel p-6 text-sm text-red-300">{error}</div>
        ) : !doc ? null : outcome ? (
          <div className="panel p-6 text-center">
            <p className="text-sm font-semibold mb-2">
              {outcome.kind === "next"
                ? outcome.nextSlot === "hr_staff" && outcome.nextName === "HR"
                  ? "✓ Signed. Sent to HR for the next signature."
                  : `✓ Signed. Sent to ${outcome.nextName} (${COMPENSATION_SLOT_LABEL[outcome.nextSlot]}) for the next signature.`
                : "✓ Signed. All signatures are in — the document is complete."}
            </p>
            {doc.pdfUrl && (
              <a href={doc.pdfUrl} target="_blank" rel="noreferrer noopener" className="text-blue-300 hover:text-blue-200 underline text-sm">
                View the signed PDF
              </a>
            )}
          </div>
        ) : !isRecipient && !isSuperadmin ? (
          <div className="panel p-6 text-sm text-muted-foreground">
            {alreadyDone ? "This document has already been signed." : "This document isn't waiting on your signature right now."}
          </div>
        ) : alreadyDone ? (
          <div className="panel p-6 text-center text-sm">
            ✓ Already signed.{" "}
            {doc.pdfUrl && <a href={doc.pdfUrl} target="_blank" rel="noreferrer noopener" className="text-blue-300 underline">View the PDF</a>}
          </div>
        ) : (
          <div className="panel p-0 overflow-hidden">
            <div className="px-4 py-4 border-b border-white/10">
              <h2 className="font-semibold text-sm">Promotion Paper and Wage Increase — Signature Requested</h2>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Review the letter below, then sign as {COMPENSATION_SLOT_LABEL[doc.recipientSlot as CompensationSignatureSlot] ?? doc.recipientSlot}. It goes to the next signer automatically.
              </p>
            </div>

            <div className="overflow-x-auto bg-white/5 p-4 flex justify-center">
              <div style={{ transform: "scale(0.78)", transformOrigin: "top center" }}>
                <style dangerouslySetInnerHTML={{ __html: compensationUpdateStyles }} />
                <div dangerouslySetInnerHTML={{ __html: buildCompensationUpdateBodyMarkup(doc.formData as unknown as CompensationUpdateFormData, logoDataUrl, doc.signatures) }} />
              </div>
            </div>

            <div className="p-4 border-t border-white/10">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Signature</label>
              <canvas {...sigPad.canvasProps} className={`bg-white rounded-md border border-white/15 block mx-auto w-full max-w-md ${sigPad.canvasProps.className}`} />
              <div className="mt-2">
                <SignaturePadControls pad={sigPad} />
              </div>
              {error && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 mt-3">{error}</p>}
              <button
                onClick={handleConfirmSign}
                disabled={signing}
                className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white mt-3 disabled:opacity-50"
              >
                {signing ? "Submitting…" : "Confirm & Sign"}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
