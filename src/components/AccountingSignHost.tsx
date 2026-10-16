/**
 * The shared Accounting sign popup (see src/lib/accountingSignature.ts) —
 * same layout as the Manager / SBM Review & Approval popup: required
 * Accounting Comments + signature. Mounted once at the app root.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";
import { registerAccountingSignAsker, type AccountingSignResult } from "@/lib/accountingSignature";

export function AccountingSignHost() {
  const [open, setOpen] = useState<{ title: string; reviewerName: string } | null>(null);
  const resolver = useRef<((v: AccountingSignResult | null) => void) | null>(null);

  useEffect(() => {
    registerAccountingSignAsker(
      (opts) =>
        new Promise<AccountingSignResult | null>((resolve) => {
          resolver.current?.(null); // a previous popup still open counts as cancelled
          resolver.current = resolve;
          setOpen(opts);
        })
    );
    return () => registerAccountingSignAsker(null);
  }, []);

  const finish = (value: AccountingSignResult | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setOpen(null);
  };

  if (!open || typeof document === "undefined") return null;
  return createPortal(<AccountingSignModal title={open.title} reviewerName={open.reviewerName} onDone={finish} />, document.body);
}

function AccountingSignModal({ title, reviewerName, onDone }: { title: string; reviewerName: string; onDone: (v: AccountingSignResult | null) => void }) {
  const [comments, setComments] = useState("");
  const [error, setError] = useState<string | null>(null);
  const sigPad = useSignaturePad({ width: 400, height: 110, defaultName: reviewerName });

  const submit = () => {
    const c = comments.trim();
    if (!c) { setError("Please add your accounting comments first."); return; }
    if (!sigPad.hasContent()) { setError("Please add your signature first."); return; }
    const dataUrl = sigPad.toDataURL();
    if (!dataUrl) { setError("Please add your signature first."); return; }
    onDone({ comments: c, dataUrl });
  };

  return (
    <div className="fixed inset-0 z-[300] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-white/10 rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-lg font-bold text-white">Accounting Review &amp; Approval</h3>
          <button onClick={() => onDone(null)} className="text-slate-400 hover:text-white transition p-1"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-slate-400 mb-3">{title}</p>
        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-1">
              Accounting Comments <span className="text-red-400 normal-case">* required</span>
            </label>
            <textarea
              autoFocus
              value={comments}
              onChange={(e) => { setComments(e.target.value); if (error && e.target.value.trim()) setError(null); }}
              rows={3}
              placeholder="Why are you approving this?"
              className="w-full bg-slate-800/50 border border-white/10 rounded-lg p-2 text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none resize-none"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-2">Your Signature</label>
            <canvas {...sigPad.canvasProps} className={`bg-white rounded-md border border-white/15 block mx-auto w-full max-w-sm ${sigPad.canvasProps.className}`} />
            <div className="mt-2"><SignaturePadControls pad={sigPad} /></div>
          </div>
        </div>
        {error && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 mb-3">{error}</p>}
        <div className="flex gap-3">
          <button type="button" onClick={submit} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-semibold text-sm">
            Confirm &amp; Sign
          </button>
          <button onClick={() => onDone(null)} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-semibold text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}
