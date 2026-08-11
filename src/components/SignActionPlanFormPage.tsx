/**
 * Sign Manager's Action Plan Form — the 4th Warning Action Plan equivalent
 * of SignDocumentPage.tsx/SignPromotionFormPage.tsx, opened from the deep
 * link a Team Messenger message sends. Unlike those two (HR pre-fills
 * every field, recipients only sign), the "manager" slot ALSO fills in the
 * 5 numbered plan sections and Manager Comments here, right alongside
 * signing — see actionPlanFormTemplate.ts's header comment. Senior Manager
 * and HR, further down the chain, only review the already-filled plan and
 * countersign — no editing.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { getSignableDocument, signDocument, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadActionPlanForm } from "@/lib/firebase/storage";
import { captureHtmlToPdfBlob, loadAssetDataUrl } from "@/lib/pdfCapture";
import { buildActionPlanFormBodyMarkup, actionPlanFormStyles, type ActionPlanFormData } from "@/lib/actionPlanFormTemplate";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { getHrNotificationSettings } from "@/lib/supabase/companySettings";
import { notifyHrRoleUsers } from "@/lib/supabase/hrRoleNotify";

interface Props {
  docId: string;
}

const SLOT_LABEL: Record<string, string> = {
  manager: "Manager",
  senior_manager: "Senior Manager",
  hr_staff: "HR/Management",
};

const PLAN_FIELDS = [
  { key: "coachingPlan", label: "1. Coaching Plan" },
  { key: "monitoringPlan", label: "2. Monitoring Plan" },
  { key: "additionalTraining", label: "3. Additional Training or Support" },
  { key: "performanceExpectations", label: "4. Performance Expectations and Timeline" },
  { key: "consequences", label: "5. Consequences if Improvement Is Not Achieved" },
] as const;

export function SignActionPlanFormPage({ docId }: Props) {
  const { ready, uid, displayName, role } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SignableDocument | null>(null);
  const [images, setImages] = useState({ logo: "", ribbon: "", footer: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);

  // Only used/shown when this recipient is the "manager" slot — see this
  // file's header comment. Seeded from doc.formData once it loads, so a
  // reload mid-fill doesn't lose anything already saved by a previous
  // (interrupted) submit attempt.
  const [planFields, setPlanFields] = useState({
    coachingPlan: "",
    monitoringPlan: "",
    additionalTraining: "",
    performanceExpectations: "",
    consequences: "",
    managerComments: "",
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasDrawnRef = useRef(false);

  useEffect(() => {
    if (!ready || !uid) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [profileId, logo, ribbon, footer, document] = await Promise.all([
          getMyProfileId(uid),
          loadAssetDataUrl(() => import("@/assets/us-in-home-services-logo.png")),
          loadAssetDataUrl(() => import("@/assets/us-in-home-services-ribbon.png")),
          loadAssetDataUrl(() => import("@/assets/us-in-home-services-footer.png")),
          getSignableDocument(docId),
        ]);
        if (cancelled) return;
        setMyProfileId(profileId);
        setImages({ logo, ribbon, footer });
        if (!document) {
          setError("This document doesn't exist or has been removed.");
        } else {
          setDoc(document);
          const data = document.formData as unknown as ActionPlanFormData;
          setPlanFields({
            coachingPlan: data.coachingPlan || "",
            monitoringPlan: data.monitoringPlan || "",
            additionalTraining: data.additionalTraining || "",
            performanceExpectations: data.performanceExpectations || "",
            consequences: data.consequences || "",
            managerComments: data.managerComments || "",
          });
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load document.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, uid, docId]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };
  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();
    hasDrawnRef.current = true;
  };
  const endDraw = () => { drawingRef.current = false; };
  const clearSignature = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    hasDrawnRef.current = false;
  };

  const isManagerSlot = doc?.recipientSlot === "manager";

  const handleConfirmSign = async () => {
    if (!doc || !myProfileId || !canvasRef.current) return;
    if (!hasDrawnRef.current) {
      setError("Please draw your signature first.");
      return;
    }
    setSigning(true);
    setError(null);
    try {
      const companyId = doc.companyId;
      const dataUrl = canvasRef.current.toDataURL("image/png");
      const signatureUrl = await uploadSignableDocumentSignature(companyId, doc.id, doc.recipientSlot, dataUrl);
      const entry = { name: displayName || "Signed", url: signatureUrl, signedAt: new Date().toISOString() };

      // Only the Manager slot's typed-in plan actually changes form_data —
      // Senior Manager/HR sign what's already there, unmodified.
      const formData: ActionPlanFormData = isManagerSlot
        ? { ...(doc.formData as unknown as ActionPlanFormData), ...planFields }
        : (doc.formData as unknown as ActionPlanFormData);

      const signatures = { ...doc.signatures, [doc.recipientSlot]: entry };
      const captureSignatures = { ...doc.signatures, [doc.recipientSlot]: { ...entry, url: dataUrl } };
      const pdfBlob = await captureHtmlToPdfBlob(buildActionPlanFormBodyMarkup(formData, images.logo, images.ribbon, images.footer, captureSignatures), actionPlanFormStyles);
      const pdfUrl = await uploadActionPlanForm(companyId, formData.employeeName, pdfBlob);

      await signDocument(doc.id, doc.recipientSlot, entry, pdfUrl, isManagerSlot ? (formData as unknown as Record<string, any>) : undefined);

      if (doc.createdBy) {
        const thread = await getOrCreateDmThread(myProfileId, doc.createdBy);
        const filename = `Signed Manager Action Plan Form - ${formData.employeeName}.pdf`;
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || "Manager",
          body: `✅ Manager's Action Plan Form for ${formData.employeeName} has been signed: [${filename}](${pdfUrl})`,
        });
      }

      // Opt-in broadcast — reuses the Warning Form's notify toggle (see
      // Notifications Settings, migration 0090) since there's no dedicated
      // action-plan-form setting yet.
      getHrNotificationSettings()
        .then(({ warningForm }) => {
          if (!warningForm) return;
          const excludeIds = doc.createdBy ? [doc.createdBy] : [];
          void notifyHrRoleUsers(myProfileId, displayName || "Manager", excludeIds, `✅ Manager's Action Plan Form for ${formData.employeeName} has been signed.`);
        })
        .catch((err) => console.error("[action-plan-form] hr notify check failed:", err));

      setDoc({ ...doc, status: "signed", pdfUrl, signatures, signedAt: entry.signedAt, formData: formData as unknown as Record<string, any> });
      void logActivity({ action: "action_plan_form_signed", targetType: "employee", targetLabel: formData.employeeName, details: { slot: doc.recipientSlot } });
      setSigned(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit signature.");
    } finally {
      setSigning(false);
    }
  };

  const isRecipient = !!doc && !!myProfileId && doc.recipientId === myProfileId;
  // Platform-level SUPERSUPERADMIN only — the per-company SUPERADMIN role
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
            <Loader2 className="h-4 w-4 animate-spin" /> Loading document…
          </div>
        ) : error && !doc ? (
          <div className="panel p-6 text-sm text-red-300">{error}</div>
        ) : !doc ? null : !isRecipient && !isSuperadmin ? (
          <div className="panel p-6 text-sm text-muted-foreground">This document isn't addressed to your account.</div>
        ) : signed || doc.status === "signed" ? (
          <div className="panel p-6 text-center">
            <p className="text-sm font-semibold mb-2">✅ Signed{signed ? " and sent back to HR" : ""}.</p>
            {doc.pdfUrl && (
              <a href={doc.pdfUrl} target="_blank" rel="noreferrer noopener" className="text-blue-300 hover:text-blue-200 underline text-sm">
                View the signed PDF
              </a>
            )}
          </div>
        ) : (
          <div className="panel p-0 overflow-hidden">
            <div className="px-4 py-4 border-b border-white/10">
              <h2 className="font-semibold text-sm">Manager's Action Plan Form — {isManagerSlot ? "Input & Signature Requested" : "Signature Requested"}</h2>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {isManagerSlot
                  ? "Fill in the action plan below, then sign as Manager."
                  : `Review the plan below, then sign as ${SLOT_LABEL[doc.recipientSlot] ?? doc.recipientSlot}.`}
              </p>
            </div>

            {isManagerSlot ? (
              <div className="p-4 space-y-3">
                {PLAN_FIELDS.map(({ key, label }) => (
                  <div key={key} className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</label>
                    <textarea
                      value={planFields[key]}
                      onChange={(e) => setPlanFields((prev) => ({ ...prev, [key]: e.target.value }))}
                      rows={2}
                      className="glass-input text-sm py-1.5 px-3 rounded-md resize-y"
                    />
                  </div>
                ))}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Manager Comments</label>
                  <textarea
                    value={planFields.managerComments}
                    onChange={(e) => setPlanFields((prev) => ({ ...prev, managerComments: e.target.value }))}
                    rows={3}
                    className="glass-input text-sm py-1.5 px-3 rounded-md resize-y"
                  />
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto bg-white/5 p-4 flex justify-center">
                <div style={{ transform: "scale(0.78)", transformOrigin: "top center" }}>
                  <style dangerouslySetInnerHTML={{ __html: actionPlanFormStyles }} />
                  <div dangerouslySetInnerHTML={{ __html: buildActionPlanFormBodyMarkup(doc.formData as unknown as ActionPlanFormData, images.logo, images.ribbon, images.footer, doc.signatures) }} />
                </div>
              </div>
            )}

            <div className="p-4 border-t border-white/10">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Draw your signature</label>
              <canvas
                ref={canvasRef}
                width={500}
                height={150}
                onPointerDown={startDraw}
                onPointerMove={moveDraw}
                onPointerUp={endDraw}
                onPointerLeave={endDraw}
                className="bg-white rounded-md border border-white/15 w-full max-w-md touch-none"
              />
              <div className="flex gap-2 mt-2">
                <button onClick={clearSignature} className="btn text-xs px-3 py-1.5">Clear</button>
              </div>

              {error && (
                <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 mt-3">{error}</p>
              )}

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
