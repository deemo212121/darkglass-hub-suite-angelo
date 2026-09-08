/**
 * External (no-login) counterpart to SignContractorAddendumPage.tsx — for a
 * Company HR Representative or managerial witness who has no AHS account.
 * Talks only to /api/signable-documents (signableDocumentsBridge.ts). The
 * PDF is built client-side with every signature so far plus this one, and
 * POSTed finished; HR finalizes the document from the dashboard once all
 * five signatures are in.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import logo from "@/assets/Admin Hub Solutions Logo no Text.png";
import { getExternalSignableDocument, submitExternalSignature, type ExternalSignableDocument } from "@/lib/supabase/externalSignableDocuments";
import { buildContractorAddendumPdf, type ContractorAddendumLayout } from "@/lib/contractorAddendumPdf";
import {
  CONTRACTOR_ADDENDUM_SLOT_ORDER,
  CONTRACTOR_ADDENDUM_SLOT_LABEL,
  CONTRACTOR_ADDENDUM_DEFAULT_SIGNER_NAMES,
  blankContractorAddendumData,
  type ContractorAddendumFormData,
} from "@/lib/contractorAddendumFormTemplate";
import type { SignatureSlot } from "@/lib/supabase/signableDocuments";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";
import { ContractorAddendumCanvas, rectStyle } from "@/components/ContractorAddendumCanvas";

interface Props {
  docId: string;
}

const fmtDate = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

async function sigBytesForSlots(
  formData: ContractorAddendumFormData,
  slots: SignatureSlot[],
): Promise<Partial<Record<SignatureSlot, Uint8Array>>> {
  const out: Partial<Record<SignatureSlot, Uint8Array>> = {};
  for (const s of slots) {
    const url = formData.signatureDataUrls?.[s];
    if (url) {
      try {
        out[s] = new Uint8Array(await (await fetch(url)).arrayBuffer());
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

export function ExternalSignContractorAddendumPage({ docId }: Props) {
  const [doc, setDoc] = useState<ExternalSignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedPdfUrl, setSubmittedPdfUrl] = useState<string | null>(null);

  const [pdf, setPdf] = useState<{ bytes: Uint8Array; layout: ContractorAddendumLayout } | null>(null);
  const [signerName, setSignerName] = useState("");
  const nameSeeded = useRef(false);
  const sigPad = useSignaturePad({ width: 440, height: 100 });
  const today = useMemo(() => fmtDate(new Date()), []);

  const slot = (doc?.recipientSlot ?? "hr_staff") as SignatureSlot;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const document = await getExternalSignableDocument(docId);
        if (cancelled) return;
        if (!document || document.documentType !== "contractor_addendum") {
          setError("This link isn't valid, or the document doesn't use link-based signing.");
          return;
        }
        setDoc(document);
        const fd = { ...blankContractorAddendumData(), ...(document.formData as Partial<ContractorAddendumFormData>) };
        if (!nameSeeded.current) {
          const s = document.recipientSlot as SignatureSlot;
          setSignerName(fd.signerNames?.[s] || CONTRACTOR_ADDENDUM_DEFAULT_SIGNER_NAMES[s] || document.recipientName || "");
          nameSeeded.current = true;
        }
        const priorSlots = CONTRACTOR_ADDENDUM_SLOT_ORDER.filter((s) => s !== document.recipientSlot);
        const priorSigs = await sigBytesForSlots(fd, priorSlots);
        if (cancelled) return;
        const built = await buildContractorAddendumPdf(fd, priorSigs);
        if (!cancelled) setPdf(built);
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

  const handleSubmit = async () => {
    if (!doc) return;
    if (!signerName.trim()) {
      setError("Enter your printed name.");
      return;
    }
    if (!sigPad.hasContent()) {
      setError("Please add your signature first.");
      return;
    }
    const dataUrl = sigPad.toDataURL();
    if (!dataUrl) {
      setError("Please add your signature first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const signedAt = new Date().toISOString();
      const signatureBlob = await (await fetch(dataUrl)).blob();

      const prev = { ...blankContractorAddendumData(), ...(doc.formData as Partial<ContractorAddendumFormData>) };
      const finalData: ContractorAddendumFormData = {
        ...prev,
        signerNames: { ...prev.signerNames, [slot]: signerName.trim() },
        datesSigned: { ...prev.datesSigned, [slot]: signedAt },
        signatureDataUrls: { ...prev.signatureDataUrls, [slot]: dataUrl },
      };

      const sigBytes = await sigBytesForSlots(finalData, CONTRACTOR_ADDENDUM_SLOT_ORDER);
      const { bytes } = await buildContractorAddendumPdf(finalData, sigBytes);
      const pdfBlob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });

      const { pdfUrl } = await submitExternalSignature(docId, { signatureBlob, pdfBlob, formData: finalData as unknown as Record<string, any> });
      setSubmittedPdfUrl(pdfUrl);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit signature.");
    } finally {
      setSubmitting(false);
    }
  };

  const renderOverlay = (pageIndex: number, scale: number) => {
    if (!pdf) return null;
    const target = pdf.layout.signatures[slot];
    if (!target || pageIndex !== target.sig.page) return null;
    const priorName = (doc?.formData as ContractorAddendumFormData | undefined)?.signerNames?.[slot];
    return (
      <>
        <canvas {...sigPad.canvasProps} style={rectStyle(target.sig, scale)} />
        {!priorName && (
          <input
            style={{ ...rectStyle(target.name, scale), fontSize: `${8 * scale}px` }}
            className="bg-blue-50/70 border border-blue-300/70 rounded-[2px] outline-none px-0.5 font-bold font-sans text-[#00008B]"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            placeholder="Your printed name"
          />
        )}
        <div style={{ ...rectStyle(target.date, scale), fontSize: `${8 * scale}px` }} className="flex items-center font-bold text-[#00008B] pointer-events-none">
          {today}
        </div>
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
        ) : !doc ? null : submitted || doc.status === "signed" || doc.status === "confirmed" ? (
          <div className="panel p-6 text-center">
            <p className="text-sm font-semibold mb-2">✅ Signed{submitted ? " and sent back to HR" : ""}.</p>
            {submittedPdfUrl ? (
              <a href={submittedPdfUrl} target="_blank" rel="noreferrer noopener" className="text-blue-300 hover:text-blue-200 underline text-sm">
                View the signed PDF
              </a>
            ) : (
              <p className="text-xs text-muted-foreground">You can close this page now.</p>
            )}
          </div>
        ) : (
          <div className="panel p-4">
            <p className="text-xs text-muted-foreground mb-3">
              Review the agreement below, then sign as <span className="font-semibold">{CONTRACTOR_ADDENDUM_SLOT_LABEL[slot]}</span>.
            </p>

            <ContractorAddendumCanvas bytes={pdf?.bytes ?? null} renderOverlay={renderOverlay} />

            <div className="mt-3 flex flex-col gap-2 max-w-md">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Printed name</label>
              <input value={signerName} onChange={(e) => setSignerName(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
            </div>

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
              {submitting ? "Submitting…" : "Confirm & Sign"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
