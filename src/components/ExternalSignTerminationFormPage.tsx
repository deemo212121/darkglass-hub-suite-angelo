/**
 * External Sign Termination Form — the no-login counterpart to
 * SignTerminationFormPage.tsx, mirroring ExternalSignPromotionFormPage.tsx
 * (talks only to /api/signable-documents, since an anonymous visitor has
 * no Supabase session for RLS to scope to).
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import logo from "@/assets/Admin Hub Solutions Logo no Text.png";
import { captureHtmlToPdfBlob, loadAssetDataUrl } from "@/lib/pdfCapture";
import { buildTerminationFormBodyMarkup, terminationFormStyles, type TerminationFormData, type TerminationSignatureSlot } from "@/lib/terminationFormTemplate";

interface Props {
  docId: string;
}

interface ExternalDoc {
  id: string;
  documentType: string;
  formData: TerminationFormData;
  signatures: Partial<Record<TerminationSignatureSlot, { name: string; url: string; signedAt: string }>>;
  status: string;
  recipientSlot: TerminationSignatureSlot;
  recipientName: string | null;
}

const SLOT_LABEL: Record<string, string> = {
  employee: "Employee",
  manager: "Manager",
  senior_manager: "Senior Manager",
  hr_staff: "HR Staff",
};

export function ExternalSignTerminationFormPage({ docId }: Props) {
  const [doc, setDoc] = useState<ExternalDoc | null>(null);
  const [images, setImages] = useState({ logo: "", ribbon: "", footer: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasDrawnRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [logoUrl, ribbonUrl, footerUrl, res] = await Promise.all([
          loadAssetDataUrl(() => import("@/assets/us-in-home-services-logo.png")),
          loadAssetDataUrl(() => import("@/assets/us-in-home-services-ribbon.png")),
          loadAssetDataUrl(() => import("@/assets/us-in-home-services-footer.png")),
          fetch(`/api/signable-documents?id=${encodeURIComponent(docId)}`),
        ]);
        if (cancelled) return;
        setImages({ logo: logoUrl, ribbon: ribbonUrl, footer: footerUrl });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(res.status === 404 ? "This link isn't valid, or the document doesn't use link-based signing." : (body.error || "Failed to load document."));
          return;
        }
        setDoc((await res.json()) as ExternalDoc);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load document.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [docId]);

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

  const handleConfirmSign = async () => {
    if (!doc || !canvasRef.current) return;
    if (!hasDrawnRef.current) {
      setError("Please draw your signature first.");
      return;
    }
    setSigning(true);
    setError(null);
    try {
      const dataUrl = canvasRef.current.toDataURL("image/png");
      const signatureBlob = await (await fetch(dataUrl)).blob();
      const signedAt = new Date().toISOString();
      const captureSignatures = { ...doc.signatures, [doc.recipientSlot]: { name: doc.recipientName ?? "Signed", url: dataUrl, signedAt } };
      const pdfBlob = await captureHtmlToPdfBlob(buildTerminationFormBodyMarkup(doc.formData, images.logo, images.ribbon, images.footer, captureSignatures), terminationFormStyles);

      const body = new FormData();
      body.set("signatureFile", signatureBlob, "signature.png");
      body.set("pdfFile", pdfBlob, "signed.pdf");
      const res = await fetch(`/api/signable-documents?id=${encodeURIComponent(docId)}&action=sign`, { method: "POST", body });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || "Failed to submit signature.");
      }

      setDoc({ ...doc, status: "signed", signatures: captureSignatures });
      setSigned(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit signature.");
    } finally {
      setSigning(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto p-4">
        <div className="flex justify-center mb-4">
          <img src={logo} alt="Admin Hub Solutions" className="h-10 w-auto opacity-80" />
        </div>

        {loading ? (
          <div className="panel p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading document…
          </div>
        ) : error && !doc ? (
          <div className="panel p-6 text-sm text-red-300">{error}</div>
        ) : !doc ? null : signed || doc.status === "signed" ? (
          <div className="panel p-6 text-center">
            <p className="text-sm font-semibold mb-2">✅ Signed{signed ? " and sent back to HR" : ""}.</p>
            <p className="text-xs text-muted-foreground">You can close this page now.</p>
          </div>
        ) : (
          <div className="panel p-0 overflow-hidden">
            <div className="px-4 py-4 border-b border-white/10">
              <h2 className="font-semibold text-sm">Notice of Termination — Signature Requested</h2>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Review the notice below, then sign as {SLOT_LABEL[doc.recipientSlot] ?? doc.recipientSlot}{doc.recipientName ? ` (${doc.recipientName})` : ""}.
              </p>
            </div>

            <div className="overflow-x-auto bg-white/5 p-4 flex justify-center">
              <div style={{ transform: "scale(0.78)", transformOrigin: "top center" }}>
                <style dangerouslySetInnerHTML={{ __html: terminationFormStyles }} />
                <div dangerouslySetInnerHTML={{ __html: buildTerminationFormBodyMarkup(doc.formData, images.logo, images.ribbon, images.footer, doc.signatures) }} />
              </div>
            </div>

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
      </div>
    </div>
  );
}
