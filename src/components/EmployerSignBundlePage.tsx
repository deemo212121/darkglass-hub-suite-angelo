/**
 * Sign Bundle — Employer side. The inverse of SignBundlePage.tsx: instead
 * of a technician filling out forms they were sent, this is HR (or
 * whoever ReportHRDaily.tsx's "Sign as Employer" tab sent the link to)
 * working through a batch of documents that are already technician-signed
 * and just need the employer's confirm/signature. Same shell (timeline +
 * Next/Back), different step content per document type:
 *
 *  - The 4 "General" confirm-only types (warning_form, promotion_form,
 *    action_plan_form, termination_form): a plain Confirm button wired to
 *    the same confirmSignableDocument() call those types' own tables use.
 *
 *  - The 6 signature-required types (Wage Ack, Meal & Rest Break, Parts
 *    Responsibility, Location Consent, Damage, Mileage & Fuel): a real
 *    signature pad. All six follow the exact same mechanical shape in
 *    ReportHRDaily.tsx's own employer-signature dialogs — capture a
 *    signature, composite it into that document's specific PDF, upload,
 *    call signDocument() then confirmSignableDocument() — just with a
 *    different fill/upload function and field-name pair per type, which
 *    is what SIGNABLE_CONFIG below captures so this one component can
 *    drive all six instead of duplicating six near-identical dialogs.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, Loader2, Menu, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  confirmSignableDocument,
  getSignableDocument,
  signDocument,
  type SignableDocument,
  type SignableDocumentType,
} from "@/lib/supabase/signableDocuments";
import { addAgentNote } from "@/lib/supabase/csrAgentNotes";
import { buildWarnNoteText } from "@/lib/warningFormTemplate";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { uploadSignableDocumentSignature, uploadWageAckForm, uploadMealRestBreakForm, uploadPartsResponsibilityForm, uploadLocationConsentForm, uploadDamageForm, uploadMileageFuelForm } from "@/lib/firebase/storage";
import { fillWageAckPdf, loadBlankWageAckBytes } from "@/lib/wageAckPdfFill";
import { fillMealRestBreakPdf, loadBlankMealRestBreakBytes } from "@/lib/mealRestBreakPdfFill";
import { fillPartsResponsibilityPdf, loadBlankPartsResponsibilityBytes } from "@/lib/partsResponsibilityPdfFill";
import { fillLocationConsentPdf, loadBlankLocationConsentBytes } from "@/lib/locationConsentPdfFill";
import { fillDamagePdf, loadBlankDamageBytes } from "@/lib/damagePdfFill";
import { fillMileageFuelPdf, loadBlankMileageFuelBytes } from "@/lib/mileageFuelPdfFill";
import { useSignaturePad, type SignaturePadHandle } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Standard US Letter height in points — every one of these PDFs uses it.
// Needed to flip pdf-lib's bottom-left-origin y coordinates into the
// top-left-origin CSS positioning the rendered canvas uses.
const PDF_PAGE_HEIGHT = 792;
const LIVE_PREVIEW_WIDTH = 620;

/**
 * A plain browser `fetch()` straight to firebasestorage.googleapis.com is
 * cross-origin and gets silently blocked — the bucket sends no
 * Access-Control-Allow-Origin header (see imageProxyBridge.ts, already used
 * by documentTemplates/generate.ts for the same reason). Routes through
 * this app's own /api/image-proxy instead, which fetches server-to-server
 * (no CORS) and hands the bytes back same-origin.
 */
async function fetchBytesViaProxy(url: string): Promise<Uint8Array> {
  const res = await fetch(`/api/image-proxy?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Renders one page of the document's CURRENT pdf (already has the
 * employee's half filled in) via pdf.js, with the in-progress employer
 * signature overlaid live at its exact final position — same coordinates
 * *PdfFill.ts uses when actually compositing it on submit. Polls the pad
 * every 150ms rather than reacting to state changes because freehand
 * "Draw" mode paints directly to its own canvas without ever touching
 * React state.
 */
function LiveDocumentPreview({
  pdfUrl,
  loadBlankBytes,
  pageIndex,
  sigRect,
  sigPad,
}: {
  pdfUrl: string | null | undefined;
  loadBlankBytes: () => Promise<Uint8Array>;
  pageIndex: number;
  sigRect: { x: number; y: number; w: number; h: number };
  sigPad: SignaturePadHandle;
}) {
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const [scale, setScale] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [liveSigUrl, setLiveSigUrl] = useState<string | null>(null);

  // Renders every page (not just the one with the signature line) so this
  // still reads as the whole document, same as the plain iframe preview
  // used to — only the live overlay img below is limited to one page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPageLoading(true);
      setPageError(null);
      try {
        const [pdfjsLib, bytes] = await Promise.all([
          import("pdfjs-dist"),
          (async () => {
            // Prefer the document's actual current PDF — it already has the
            // employee's filled-in fields/signature composited in — and
            // only fall back to the blank template if that fetch fails
            // (e.g. a storage CORS hiccup), so a bad fetch degrades the
            // preview instead of breaking it.
            if (pdfUrl) {
              try {
                return await fetchBytesViaProxy(pdfUrl);
              } catch {
                // fall through to blank template below
              }
            }
            return loadBlankBytes();
          })(),
        ]);
        if (cancelled) return;
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (cancelled) return;
        setNumPages(pdf.numPages);
        const firstPage = await pdf.getPage(1);
        const fitScale = LIVE_PREVIEW_WIDTH / firstPage.getViewport({ scale: 1 }).width;
        const dpr = window.devicePixelRatio || 1;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: fitScale });
          const canvas = canvasRefs.current[i - 1];
          if (!canvas || cancelled) return;
          canvas.width = viewport.width * dpr;
          canvas.height = viewport.height * dpr;
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          const ctx = canvas.getContext("2d")!;
          ctx.scale(dpr, dpr);
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        }
        if (cancelled) return;
        setScale(fitScale);
      } catch (err) {
        if (!cancelled) setPageError(err instanceof Error ? err.message : "Failed to render preview.");
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pdfUrl, loadBlankBytes]);

  useEffect(() => {
    const tick = () => setLiveSigUrl(sigPad.toDataURL());
    tick();
    const id = window.setInterval(tick, 150);
    return () => window.clearInterval(id);
  }, [sigPad]);

  const overlayStyle: CSSProperties = {
    position: "absolute",
    left: sigRect.x * scale,
    top: (PDF_PAGE_HEIGHT - sigRect.y - sigRect.h) * scale,
    width: sigRect.w * scale,
    height: sigRect.h * scale,
  };

  return (
    <div className="rounded-lg overflow-hidden border border-white/10 bg-slate-900" style={{ maxHeight: "75vh", overflowY: "auto" }}>
      {pageError ? (
        <div className="bg-white text-red-600 text-xs p-4 text-center">{pageError}</div>
      ) : (
        <div className="flex flex-col items-center gap-3 p-3">
          {Array.from({ length: numPages || 1 }).map((_, i) => (
            <div key={i} className="relative inline-block bg-white shadow">
              <canvas ref={(el) => { canvasRefs.current[i] = el; }} className="block" />
              {i === pageIndex && !pageLoading && liveSigUrl && (
                <img src={liveSigUrl} alt="Your signature (live preview)" style={overlayStyle} className="pointer-events-none" />
              )}
            </div>
          ))}
          {pageLoading && (
            <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          )}
        </div>
      )}
    </div>
  );
}

const CONFIRM_ONLY_LABELS: Partial<Record<SignableDocumentType, string>> = {
  warning_form: "Employee Warning Form",
  promotion_form: "Promotion / Role Change Form",
  action_plan_form: "Manager's Action Plan Form",
  termination_form: "Notice of Termination",
};
const CONFIRM_ONLY_ACTIVITY: Partial<Record<SignableDocumentType, string>> = {
  warning_form: "warning_form_confirmed",
  promotion_form: "promotion_form_confirmed",
  action_plan_form: "action_plan_form_confirmed",
  termination_form: "termination_form_confirmed",
};

interface SignableConfig {
  label: string;
  fillPdf: (formData: any, employeeSigBytes: Uint8Array | undefined, employerSigBytes: Uint8Array) => Promise<Uint8Array>;
  uploadPdf: (companyId: string, name: string, blob: Blob) => Promise<string>;
  employeeSigField: string;
  employerSigField: string;
  employerDateField: string;
  filenamePrefix: string;
  activityAction: string;
  // Exact placement of the employer/manager signature on the real PDF —
  // pulled straight from each type's own *PdfFill.ts (pdf-lib coordinates,
  // origin bottom-left, in points), the same numbers used when the final
  // signed PDF gets composited on submit. Lets the live preview overlay
  // the in-progress signature at the identical spot instead of guessing.
  sigPageIndex: number;
  sigRect: { x: number; y: number; w: number; h: number };
  // Loads the type's blank template PDF — a local bundled asset, not a
  // network fetch. Fallback for the live preview when fetching the
  // document's actual current pdfUrl fails (e.g. a storage CORS hiccup);
  // see LiveDocumentPreview.
  loadBlankBytes: () => Promise<Uint8Array>;
}
const SIGNABLE_CONFIG: Partial<Record<SignableDocumentType, SignableConfig>> = {
  wage_ack: {
    label: "Acknowledgment of Wage",
    fillPdf: fillWageAckPdf, uploadPdf: uploadWageAckForm,
    employeeSigField: "employeeSignatureDataUrl", employerSigField: "employerSignatureDataUrl", employerDateField: "employerDateSigned",
    filenamePrefix: "acknowledgment-of-wage", activityAction: "wage_ack_employer_signed",
    sigPageIndex: 1, sigRect: { x: 258, y: 488, w: 125, h: 13 }, loadBlankBytes: loadBlankWageAckBytes,
  },
  meal_rest_break: {
    label: "Meal & Rest Break Policy",
    fillPdf: fillMealRestBreakPdf, uploadPdf: uploadMealRestBreakForm,
    employeeSigField: "employeeSignatureDataUrl", employerSigField: "employerSignatureDataUrl", employerDateField: "employerDateSigned",
    filenamePrefix: "meal-rest-break", activityAction: "meal_rest_break_employer_signed",
    sigPageIndex: 0, sigRect: { x: 253, y: 217, w: 195, h: 20 }, loadBlankBytes: loadBlankMealRestBreakBytes,
  },
  parts_responsibility: {
    label: "Parts Responsibility Form",
    fillPdf: fillPartsResponsibilityPdf, uploadPdf: uploadPartsResponsibilityForm,
    // Named "technician"/"manager" instead of "employee"/"employer" on this one type — same shape otherwise.
    employeeSigField: "technicianSignatureDataUrl", employerSigField: "managerSignatureDataUrl", employerDateField: "managerDateSigned",
    filenamePrefix: "parts-responsibility", activityAction: "parts_responsibility_manager_signed",
    sigPageIndex: 1, sigRect: { x: 234, y: 561.7, w: 260, h: 20 }, loadBlankBytes: loadBlankPartsResponsibilityBytes,
  },
  location_consent: {
    label: "Location Sharing Consent",
    fillPdf: fillLocationConsentPdf, uploadPdf: uploadLocationConsentForm,
    employeeSigField: "employeeSignatureDataUrl", employerSigField: "employerSignatureDataUrl", employerDateField: "employerDateSigned",
    filenamePrefix: "location-consent", activityAction: "location_consent_employer_signed",
    sigPageIndex: 1, sigRect: { x: 256, y: 673, w: 125, h: 20 }, loadBlankBytes: loadBlankLocationConsentBytes,
  },
  damage: {
    label: "Damage Agreement",
    fillPdf: fillDamagePdf, uploadPdf: uploadDamageForm,
    employeeSigField: "employeeSignatureDataUrl", employerSigField: "employerSignatureDataUrl", employerDateField: "employerDateSigned",
    filenamePrefix: "damage", activityAction: "damage_employer_signed",
    sigPageIndex: 1, sigRect: { x: 256, y: 631, w: 125, h: 20 }, loadBlankBytes: loadBlankDamageBytes,
  },
  mileage_fuel: {
    label: "Mileage & Fuel Policy",
    fillPdf: fillMileageFuelPdf, uploadPdf: uploadMileageFuelForm,
    employeeSigField: "employeeSignatureDataUrl", employerSigField: "employerSignatureDataUrl", employerDateField: "employerDateSigned",
    filenamePrefix: "mileage-fuel", activityAction: "mileage_fuel_employer_signed", loadBlankBytes: loadBlankMileageFuelBytes,
    sigPageIndex: 1, sigRect: { x: 256, y: 695.5, w: 215, h: 20 },
  },
};

function labelFor(type: SignableDocumentType): string {
  return CONFIRM_ONLY_LABELS[type] ?? SIGNABLE_CONFIG[type]?.label ?? type;
}

function parseIds(): string[] {
  if (typeof window === "undefined") return [];
  const raw = new URLSearchParams(window.location.search).get("ids") ?? "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function isFinished(doc: SignableDocument): boolean {
  return doc.status === "confirmed";
}

export function EmployerSignBundlePage() {
  const { ready, uid, displayName } = useAuth();
  const ids = useMemo(parseIds, []);
  const [docs, setDocs] = useState<Record<string, SignableDocument | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const sigPad = useSignaturePad();

  useEffect(() => {
    if (ids.length === 0) {
      setError("No documents were specified in this link.");
      setLoading(false);
      return;
    }
    if (!ready || !uid) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const results = await Promise.all(ids.map((id) => getSignableDocument(id)));
        if (cancelled) return;
        const byId: Record<string, SignableDocument | null> = {};
        ids.forEach((id, i) => { byId[id] = results[i]; });
        setDocs(byId);
        const firstPending = ids.findIndex((id) => byId[id] && !isFinished(byId[id]!));
        setIndex(firstPending >= 0 ? firstPending : 0);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load these documents.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, uid]);

  // Fresh signature pad + cleared error every time the step changes.
  useEffect(() => {
    sigPad.clear();
    setStepError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const currentId = ids[index];
  const currentDoc = currentId ? docs[currentId] : null;

  const refreshCurrent = async (id: string) => {
    try {
      const fresh = await getSignableDocument(id);
      setDocs((prev) => ({ ...prev, [id]: fresh }));
    } catch {
      // Non-fatal — the timeline just won't reflect the latest status until next refresh.
    }
  };

  const goNext = () => setIndex((i) => Math.min(ids.length - 1, i + 1));
  const goBack = () => setIndex((i) => Math.max(0, i - 1));

  const handleConfirm = async (doc: SignableDocument) => {
    if (!uid) return;
    setBusy(true);
    setStepError(null);
    try {
      const data = doc.formData as any;
      let noteId: string | null = null;
      if (doc.documentType === "warning_form" && data.employeeId) {
        noteId = await addAgentNote({ agentProfileId: data.employeeId, type: "warning", note: buildWarnNoteText(data), fastTrackToApproved: true });
      }
      await confirmSignableDocument(doc.id, noteId);
      void logActivity({
        action: CONFIRM_ONLY_ACTIVITY[doc.documentType] ?? "document_confirmed",
        targetType: "employee",
        targetId: data.employeeId,
        targetLabel: data.employeeName,
      });
      await refreshCurrent(doc.id);
      goNext();
    } catch (err) {
      setStepError(err instanceof Error ? err.message : "Failed to confirm this document.");
    } finally {
      setBusy(false);
    }
  };

  const handleSignatureSubmit = async (doc: SignableDocument) => {
    const config = SIGNABLE_CONFIG[doc.documentType];
    if (!config) return;
    if (!sigPad.hasContent()) {
      setStepError("Please add your signature.");
      return;
    }
    setBusy(true);
    setStepError(null);
    try {
      const existing = doc.formData as any;
      const employeeSigUrl = existing[config.employeeSigField] as string | undefined;
      const employeeSigBytes = employeeSigUrl ? await fetchBytesViaProxy(employeeSigUrl) : undefined;

      const dataUrl = sigPad.toDataURL();
      if (!dataUrl) { setStepError("Please add your signature."); setBusy(false); return; }
      const employerSigBytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
      const signatureUrl = await uploadSignableDocumentSignature(doc.companyId, doc.id, "hr_staff", dataUrl);
      const signedAt = new Date().toISOString();

      const merged = { ...existing, [config.employerSigField]: dataUrl, [config.employerDateField]: signedAt };
      const pdfBytes = await config.fillPdf(merged, employeeSigBytes, employerSigBytes);
      const pdfUrl = await config.uploadPdf(doc.companyId, existing.employeeName || config.filenamePrefix, new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" }));

      const entry = { name: displayName || "Employer", url: signatureUrl, signedAt };
      await signDocument(doc.id, "hr_staff", entry, pdfUrl, merged as unknown as Record<string, any>);
      await confirmSignableDocument(doc.id, null);

      void logActivity({ action: config.activityAction, targetType: "employee", targetLabel: existing.employeeName || "" });
      sigPad.clear();
      await refreshCurrent(doc.id);
      goNext();
    } catch (err) {
      setStepError(err instanceof Error ? err.message : "Failed to save signature.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || ids.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
        <div className="panel max-w-md text-center p-6">
          <h1 className="text-lg font-semibold">Couldn't open these documents</h1>
          <p className="text-sm text-muted-foreground mt-2">{error ?? "This link is missing its documents."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-950">
      <div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between gap-3 bg-slate-900">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="md:hidden btn text-xs px-2 py-1.5"
            title="Show all documents in this bundle"
          >
            {sidebarOpen ? <X className="h-3.5 w-3.5" /> : <Menu className="h-3.5 w-3.5" />}
          </button>
          <p className="text-sm font-semibold">
            Document {index + 1} of {ids.length}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goBack}
            disabled={index === 0}
            className="btn text-xs px-3 py-1.5 flex items-center gap-1 disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Back
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={index >= ids.length - 1}
            className="btn text-xs px-3 py-1.5 flex items-center gap-1 disabled:opacity-40"
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 relative">
        <aside className={`${sidebarOpen ? "flex" : "hidden"} md:flex flex-col absolute md:static inset-y-0 left-0 z-20 w-64 shrink-0 border-r border-white/10 bg-slate-900 md:bg-slate-900/60 overflow-y-auto py-3`}>
          {ids.map((id, i) => {
            const doc = docs[id];
            const finished = doc ? isFinished(doc) : false;
            return (
              <button
                key={id}
                type="button"
                onClick={() => { setIndex(i); setSidebarOpen(false); }}
                className={`w-full text-left px-4 py-2.5 flex items-center gap-2 text-sm transition-colors ${
                  i === index ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                }`}
              >
                {finished ? (
                  <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 opacity-50" />
                )}
                <span className="truncate">{doc ? labelFor(doc.documentType) : "Document unavailable"}</span>
              </button>
            );
          })}
        </aside>
        {sidebarOpen && (
          <div className="md:hidden fixed inset-0 z-10 bg-black/50" onClick={() => setSidebarOpen(false)} />
        )}

        <main className="flex-1 min-w-0 overflow-y-auto p-6">
          {!currentDoc ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-sm text-muted-foreground">This document is no longer available.</p>
            </div>
          ) : (
            (() => {
              const data = currentDoc.formData as any;
              const name = data?.employeeName || currentDoc.recipientName || "—";
              const isConfirmOnly = currentDoc.documentType in CONFIRM_ONLY_LABELS;
              const signableConfig = SIGNABLE_CONFIG[currentDoc.documentType];
              const alreadyConfirmed = currentDoc.status === "confirmed";

              let actionPanel: ReactNode;
              if (alreadyConfirmed) {
                actionPanel = (
                  <div className="panel p-6 text-center">
                    <p className="text-sm font-semibold mb-2">✅ Already confirmed.</p>
                    <p className="text-xs text-muted-foreground">{labelFor(currentDoc.documentType)} for {name}.</p>
                  </div>
                );
              } else if (isConfirmOnly) {
                actionPanel = (
                  <div className="panel p-6 text-center">
                    <p className="text-sm font-semibold mb-1">{labelFor(currentDoc.documentType)}</p>
                    <p className="text-xs text-muted-foreground mb-4">{name} has signed — confirming this finalizes it as the official record.</p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleConfirm(currentDoc)}
                      className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                    >
                      {busy ? "Confirming…" : "Confirm"}
                    </button>
                    {stepError && (
                      <p className="mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{stepError}</p>
                    )}
                  </div>
                );
              } else if (signableConfig) {
                actionPanel = (
                  <div className="panel p-6 text-center">
                    <p className="text-sm font-semibold mb-1">{signableConfig.label}</p>
                    <p className="text-xs text-muted-foreground mb-4">{name} has signed — add your signature below to finalize it.</p>
                    <div className="flex justify-center mb-3">
                      <canvas {...sigPad.canvasProps} className={`bg-white rounded-md border border-white/20 ${sigPad.canvasProps.className}`} />
                    </div>
                    <div className="mb-4">
                      <SignaturePadControls pad={sigPad} />
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleSignatureSubmit(currentDoc)}
                      className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                    >
                      {busy ? "Saving…" : "Sign & Confirm"}
                    </button>
                    {stepError && (
                      <p className="mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{stepError}</p>
                    )}
                  </div>
                );
              } else {
                actionPanel = (
                  <div className="panel p-6 text-center">
                    <p className="text-sm font-semibold mb-1">{labelFor(currentDoc.documentType)}</p>
                    <p className="text-xs text-muted-foreground">
                      {name} has signed — this document type isn't supported in this combined view yet.
                      Open it from its own tab in the HR dashboard instead.
                    </p>
                  </div>
                );
              }

              // The document already has a PDF by this point — the employee's
              // own fill/sign step (or, for confirm-only types, the original
              // send) generated it — so show it read-only next to whatever
              // action this step needs. For an in-progress signature step,
              // show a LIVE version instead — your signature appears on the
              // actual document, at its exact final position, as you type
              // or draw it, before you ever submit.
              const showLivePreview = signableConfig && !alreadyConfirmed;
              return (
                <div className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-6 items-start justify-center">
                  <div className="w-full lg:w-[420px] lg:shrink-0">{actionPanel}</div>
                  {showLivePreview ? (
                    <div className="w-full lg:w-auto lg:shrink-0">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Document Preview — live</p>
                      <LiveDocumentPreview
                        pdfUrl={currentDoc.pdfUrl}
                        loadBlankBytes={signableConfig!.loadBlankBytes}
                        pageIndex={signableConfig!.sigPageIndex}
                        sigRect={signableConfig!.sigRect}
                        sigPad={sigPad}
                      />
                    </div>
                  ) : currentDoc.pdfUrl && (
                    <div className="w-full lg:flex-1 min-w-0">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Document Preview</p>
                      <div className="rounded-lg border border-white/10 overflow-hidden bg-white" style={{ height: "75vh" }}>
                        <iframe src={currentDoc.pdfUrl} title="Document preview" className="w-full h-full border-0" />
                      </div>
                    </div>
                  )}
                </div>
              );
            })()
          )}
        </main>
      </div>
    </div>
  );
}
