/**
 * External (no-login) counterpart to FillContractorAddendumPage.tsx — opened
 * from the link HR generates when the Contractor has no AHS account. Talks
 * only to /api/signable-documents (signableDocumentsBridge.ts), which only
 * serves documents with recipient_id IS NULL. The PDF is built entirely
 * client-side via contractorAddendumPdf.ts and POSTed already-finished.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import logo from "@/assets/Admin Hub Solutions Logo no Text.png";
import { getExternalSignableDocument, submitExternalSignature, type ExternalSignableDocument } from "@/lib/supabase/externalSignableDocuments";
import {
  loadBlankContractorAddendum,
  fillContractorAddendumPdf,
  type ContractorAddendumLayout,
} from "@/lib/contractorAddendumPdf";
import {
  blankContractorAddendumData,
  type ContractorAddendumFormData,
} from "@/lib/contractorAddendumFormTemplate";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";
import { ContractorAddendumCanvas, rectStyle } from "@/components/ContractorAddendumCanvas";

interface Props {
  docId: string;
}

const fmtDate = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
const overlayInputCls =
  "bg-blue-50/70 border border-blue-300/70 rounded-[2px] outline-none px-0.5 font-bold font-sans text-[#00008B] focus:bg-blue-100/80 focus:border-blue-400";

export function ExternalFillContractorAddendumPage({ docId }: Props) {
  const [doc, setDoc] = useState<ExternalSignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedPdfUrl, setSubmittedPdfUrl] = useState<string | null>(null);

  const [blank, setBlank] = useState<{ bytes: Uint8Array; layout: ContractorAddendumLayout } | null>(null);
  const [positionLevel, setPositionLevel] = useState("");
  const [baselinePayout, setBaselinePayout] = useState("");
  const [contractorName, setContractorName] = useState("");
  const sigPad = useSignaturePad({ defaultName: contractorName, width: 440, height: 100 });
  const today = useMemo(() => fmtDate(new Date()), []);
  const nameSeeded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [document, built] = await Promise.all([getExternalSignableDocument(docId), loadBlankContractorAddendum()]);
        if (cancelled) return;
        setBlank(built);
        if (!document || document.documentType !== "contractor_addendum") {
          setError("This link isn't valid, or the document doesn't use link-based signing.");
        } else {
          setDoc(document);
          const existing = document.formData as Partial<ContractorAddendumFormData>;
          if (existing.positionLevel) setPositionLevel(existing.positionLevel);
          if (existing.baselinePayout) setBaselinePayout(existing.baselinePayout);
          const priorName = existing.signerNames?.employee || document.recipientName || "";
          if (priorName && !nameSeeded.current) {
            setContractorName(priorName);
            nameSeeded.current = true;
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load document.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docId]);

  const validate = (): string | null => {
    if (!positionLevel.trim()) return "Enter the Position Level.";
    if (!baselinePayout.trim()) return "Enter the Guaranteed Minimum Baseline Payout.";
    if (!contractorName.trim()) return "Enter your printed name.";
    if (!sigPad.hasContent()) return "Please add your signature.";
    return null;
  };

  const handleSubmit = async () => {
    if (!doc) return;
    const v = validate();
    if (v) {
      setError(v);
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
      const signedAt = new Date().toISOString();
      const signatureBlob = await (await fetch(dataUrl)).blob();
      const sigBytes = new Uint8Array(await signatureBlob.arrayBuffer());

      const finalData: ContractorAddendumFormData = {
        ...blankContractorAddendumData(),
        ...(doc.formData as Partial<ContractorAddendumFormData>),
        positionLevel: positionLevel.trim(),
        baselinePayout: baselinePayout.trim(),
        signerNames: { ...(doc.formData as ContractorAddendumFormData).signerNames, employee: contractorName.trim() },
        datesSigned: { ...(doc.formData as ContractorAddendumFormData).datesSigned, employee: signedAt },
        signatureDataUrls: { ...(doc.formData as ContractorAddendumFormData).signatureDataUrls, employee: dataUrl },
      };

      const pdfBytes = await fillContractorAddendumPdf(finalData, { employee: sigBytes });
      const pdfBlob = new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" });
      const { pdfUrl } = await submitExternalSignature(docId, { signatureBlob, pdfBlob, formData: finalData as unknown as Record<string, any> });

      setSubmittedPdfUrl(pdfUrl);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit form.");
    } finally {
      setSubmitting(false);
    }
  };

  const renderOverlay = (pageIndex: number, scale: number) => {
    if (!blank) return null;
    const { layout } = blank;
    const emp = layout.signatures.employee;
    return (
      <>
        {pageIndex === layout.positionLevel.page && (
          <input
            style={{ ...rectStyle(layout.positionLevel, scale), fontSize: `${8 * scale}px` }}
            className={overlayInputCls}
            value={positionLevel}
            onChange={(e) => setPositionLevel(e.target.value)}
            placeholder="Position Level"
          />
        )}
        {pageIndex === layout.baselinePayout.page && (
          <input
            style={{ ...rectStyle(layout.baselinePayout, scale), fontSize: `${8 * scale}px` }}
            className={overlayInputCls}
            value={baselinePayout}
            inputMode="numeric"
            onChange={(e) => setBaselinePayout(e.target.value.replace(/[^\d.,]/g, ""))}
            placeholder="0.00"
          />
        )}
        {emp && pageIndex === emp.name.page && (
          <input
            style={{ ...rectStyle(emp.name, scale), fontSize: `${8 * scale}px` }}
            className={overlayInputCls}
            value={contractorName}
            onChange={(e) => setContractorName(e.target.value)}
            placeholder="Your printed name"
          />
        )}
        {emp && pageIndex === emp.sig.page && (
          <>
            <canvas {...sigPad.canvasProps} style={rectStyle(emp.sig, scale)} />
            <div style={{ ...rectStyle(emp.date, scale), fontSize: `${8 * scale}px` }} className="flex items-center font-bold text-[#00008B] pointer-events-none">
              {today}
            </div>
          </>
        )}
      </>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-4">
        <div className="flex justify-center mb-4">
          <img src={logo} alt="Admin Hub Solutions" className="h-10 w-auto opacity-80" />
        </div>

        {loading ? (
          <div className="panel p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading document…
          </div>
        ) : error && !doc ? (
          <div className="panel p-6 text-sm text-red-300">{error}</div>
        ) : !doc ? null : submitted || doc.status === "signed" ? (
          <div className="panel p-6 text-center">
            <p className="text-sm font-semibold mb-2">✅ Submitted{submitted ? " and sent back to HR" : ""}.</p>
            <p className="text-xs text-muted-foreground mb-2">HR will route it to the Company HR Representative and the managerial witnesses.</p>
            {submittedPdfUrl ? (
              <a href={submittedPdfUrl} target="_blank" rel="noreferrer noopener" className="text-blue-300 hover:text-blue-200 underline text-sm">
                View the completed PDF
              </a>
            ) : (
              <p className="text-xs text-muted-foreground">You can close this page now.</p>
            )}
          </div>
        ) : (
          <div className="panel p-4">
            <p className="text-xs text-muted-foreground mb-3">
              Fill in the Position Level, the Guaranteed Minimum Baseline Payout, and your printed name, review the agreement, add your signature, then submit.
            </p>

            <ContractorAddendumCanvas bytes={blank?.bytes ?? null} renderOverlay={renderOverlay} />

            <div className="flex items-center justify-center mt-2">
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
              {submitting ? "Submitting…" : "Submit"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
