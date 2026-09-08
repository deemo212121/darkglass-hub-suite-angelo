/**
 * Sign Master Independent Contractor Subcontractor Agreement Addendum — for
 * every party after the Contractor: Company HR Representative (`hr_staff`)
 * and the three managerial witnesses (`manager` = Technical COO,
 * `senior_manager` = Technical Director, `executive` = CEO). Opened from the
 * deep link HR's "Send to next signer" action sends.
 *
 * Renders the current document (Contractor's field values + every signature
 * captured so far) with one signature pad over this slot's line, plus an
 * editable printed-name box (defaults to the signer's display name). When
 * this signature completes the set of five, the document is confirmed.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { getSignableDocument, signDocument, confirmSignableDocument, type SignableDocument } from "@/lib/supabase/signableDocuments";
import { uploadSignableDocumentSignature, uploadContractorAddendumForm, refreshStorageAuthToken } from "@/lib/firebase/storage";
import { buildContractorAddendumPdf, type ContractorAddendumLayout } from "@/lib/contractorAddendumPdf";
import {
  CONTRACTOR_ADDENDUM_SLOT_ORDER,
  CONTRACTOR_ADDENDUM_SLOT_LABEL,
  CONTRACTOR_ADDENDUM_DEFAULT_SIGNER_NAMES,
  canManageContractorAddendum,
  canSignContractorAddendumSlot,
  blankContractorAddendumData,
  type ContractorAddendumFormData,
} from "@/lib/contractorAddendumFormTemplate";
import type { SignatureSlot } from "@/lib/supabase/signableDocuments";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { logActivity } from "@/lib/supabase/hrActivityLog";
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
        /* skip a signature that won't load rather than blocking the page */
      }
    }
  }
  return out;
}

export function SignContractorAddendumPage({ docId }: Props) {
  const { ready, uid, displayName, role, extraRoles } = useAuth();
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);

  const [pdf, setPdf] = useState<{ bytes: Uint8Array; layout: ContractorAddendumLayout } | null>(null);
  const [signerName, setSignerName] = useState("");
  const sigPad = useSignaturePad({ width: 440, height: 100 });
  const today = useMemo(() => fmtDate(new Date()), []);

  const canManage = canManageContractorAddendum(role, extraRoles);
  // Admin / Super Admin can bypass the routed chain and sign ANY unsigned
  // slot from this one page; everyone else signs the slot it's routed to.
  const [activeSlot, setActiveSlot] = useState<SignatureSlot | null>(null);
  const [positionLevelDraft, setPositionLevelDraft] = useState("");
  const [baselinePayoutDraft, setBaselinePayoutDraft] = useState("");
  const slot = (activeSlot ?? doc?.recipientSlot ?? "hr_staff") as SignatureSlot;

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
        if (!document || document.documentType !== "contractor_addendum") {
          setError("This document doesn't exist or has been removed.");
          return;
        }
        setDoc(document);
        const fd = { ...blankContractorAddendumData(), ...(document.formData as Partial<ContractorAddendumFormData>) };
        setActiveSlot((document.recipientSlot as SignatureSlot) ?? "hr_staff");
        setPositionLevelDraft(fd.positionLevel || "");
        setBaselinePayoutDraft(fd.baselinePayout || "");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load document.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, uid, docId]);

  // (Re)build the preview PDF and re-seed the printed name whenever the doc
  // loads or the privileged signer switches which slot they're signing.
  useEffect(() => {
    if (!doc || !activeSlot) return;
    let cancelled = false;
    (async () => {
      const fd = { ...blankContractorAddendumData(), ...(doc.formData as Partial<ContractorAddendumFormData>) };
      setSignerName(fd.signerNames?.[activeSlot] || CONTRACTOR_ADDENDUM_DEFAULT_SIGNER_NAMES[activeSlot] || displayName || "");
      try {
        const priorSlots = CONTRACTOR_ADDENDUM_SLOT_ORDER.filter((s) => s !== activeSlot);
        const priorSigs = await sigBytesForSlots(fd, priorSlots);
        if (cancelled) return;
        const built = await buildContractorAddendumPdf(fd, priorSigs);
        if (!cancelled) setPdf(built);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to render the document.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, activeSlot, displayName]);

  const isRecipient = !!doc && !!myProfileId && doc.recipientId === myProfileId;
  const canSignHere = isRecipient || canSignContractorAddendumSlot(slot, role, extraRoles);
  const remainingSlots = doc ? CONTRACTOR_ADDENDUM_SLOT_ORDER.filter((s) => !doc.signatures[s]) : [];

  const handleSign = async () => {
    if (!doc || !myProfileId) return;
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
    setSigning(true);
    setError(null);
    try {
      const companyId = doc.companyId;
      await refreshStorageAuthToken();
      const signedAt = new Date().toISOString();

      const prev = { ...blankContractorAddendumData(), ...(doc.formData as Partial<ContractorAddendumFormData>) };
      const finalData: ContractorAddendumFormData = {
        ...prev,
        // A privileged signer bypassing the chain may also fill the top
        // fields if the Contractor never did.
        positionLevel: canManage && !prev.positionLevel ? positionLevelDraft.trim() : prev.positionLevel,
        baselinePayout: canManage && !prev.baselinePayout ? baselinePayoutDraft.trim() : prev.baselinePayout,
        signerNames: { ...prev.signerNames, [slot]: signerName.trim() },
        datesSigned: { ...prev.datesSigned, [slot]: signedAt },
        signatureDataUrls: { ...prev.signatureDataUrls, [slot]: dataUrl },
      };

      const allSlots = CONTRACTOR_ADDENDUM_SLOT_ORDER;
      const sigBytes = await sigBytesForSlots(finalData, allSlots);
      const { bytes } = await buildContractorAddendumPdf(finalData, sigBytes);

      const signatureUrl = await uploadSignableDocumentSignature(companyId, doc.id, slot, dataUrl);
      const pdfUrl = await uploadContractorAddendumForm(
        companyId,
        finalData.signerNames.employee || "contractor-addendum",
        new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }),
      );

      const entry = { name: signerName.trim() || displayName || "Signed", url: signatureUrl, signedAt };
      await signDocument(doc.id, slot, entry, pdfUrl, finalData as unknown as Record<string, any>);

      const complete = allSlots.every((s) => s === slot || !!doc.signatures[s]);
      if (complete) await confirmSignableDocument(doc.id, null);

      if (doc.createdBy) {
        const thread = await getOrCreateDmThread(myProfileId, doc.createdBy);
        const who = CONTRACTOR_ADDENDUM_SLOT_LABEL[slot];
        const filename = `Master Independent Contractor Subcontractor Agreement Addendum - ${finalData.signerNames.employee || ""}.pdf`;
        await sendMessage({
          dmThreadId: thread.id,
          senderId: myProfileId,
          senderName: displayName || who,
          body: complete
            ? `✅ Master Independent Contractor Subcontractor Agreement Addendum for ${finalData.signerNames.employee || "the Contractor"} is fully signed: [${filename}](${pdfUrl})`
            : `📄 Master Independent Contractor Subcontractor Agreement Addendum signed by ${who} — route it to the next signer: [${filename}](${pdfUrl})`,
        });
      }

      const nextDoc = { ...doc, status: (complete ? "confirmed" : "signed") as SignableDocument["status"], pdfUrl, formData: finalData as unknown as Record<string, any>, signatures: { ...doc.signatures, [slot]: entry }, signedAt };
      setDoc(nextDoc);
      void logActivity({
        action: complete ? "contractor_addendum_finalized" : "contractor_addendum_signed",
        targetType: "employee",
        targetLabel: finalData.signerNames.employee || "",
        details: { slot },
      });

      // Privileged bypass: if more slots remain, stay on the page and move
      // straight to the next one instead of showing the "done" screen.
      const stillRemaining = CONTRACTOR_ADDENDUM_SLOT_ORDER.filter((s) => !nextDoc.signatures[s]);
      if (canManage && stillRemaining.length > 0) {
        sigPad.clear();
        setActiveSlot(stillRemaining[0]);
      } else {
        setSigned(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit signature.");
    } finally {
      setSigning(false);
    }
  };

  const renderOverlay = (pageIndex: number, scale: number) => {
    if (!pdf) return null;
    const target = pdf.layout.signatures[slot];
    if (!target || pageIndex !== target.sig.page) return null;
    return (
      <>
        <canvas {...sigPad.canvasProps} style={rectStyle(target.sig, scale)} />
        {!doc?.formData || !(doc.formData as ContractorAddendumFormData).signerNames?.[slot] ? (
          <input
            style={{ ...rectStyle(target.name, scale), fontSize: `${8 * scale}px` }}
            className="bg-blue-50/70 border border-blue-300/70 rounded-[2px] outline-none px-0.5 font-bold font-sans text-[#00008B]"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            placeholder="Your printed name"
          />
        ) : null}
        <div style={{ ...rectStyle(target.date, scale), fontSize: `${8 * scale}px` }} className="flex items-center font-bold text-[#00008B] pointer-events-none">
          {today}
        </div>
      </>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-4xl mx-auto p-4">
        <Link to="/home" className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 w-fit mb-4">
          <ChevronLeft className="h-3.5 w-3.5" /> Home
        </Link>

        {loading ? (
          <div className="panel p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading document…
          </div>
        ) : error && !doc ? (
          <div className="panel p-6 text-sm text-red-300">{error}</div>
        ) : !doc ? null : !canSignHere ? (
          <div className="panel p-6 text-sm text-muted-foreground">This document isn't addressed to your account.</div>
        ) : signed || doc.status === "confirmed" || (doc.status === "signed" && !canManage) ? (
          <div className="panel p-6 text-center">
            <p className="text-sm font-semibold mb-2">✅ Signed{signed ? " and sent back to HR" : ""}.</p>
            {doc.pdfUrl && (
              <a href={doc.pdfUrl} target="_blank" rel="noreferrer noopener" className="text-blue-300 hover:text-blue-200 underline text-sm">
                View the signed PDF
              </a>
            )}
          </div>
        ) : (
          <div className="panel p-4">
            {canManage && (
              <div className="mb-3 rounded-md border border-blue-400/30 bg-blue-400/10 px-3 py-2.5 flex flex-col gap-2">
                <p className="text-[11px] text-blue-200">Admin bypass — sign any remaining party. Sign each in turn; the addendum finalizes once all five are done.</p>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Signing as</label>
                  <select
                    value={slot}
                    onChange={(e) => setActiveSlot(e.target.value as SignatureSlot)}
                    className="glass-input text-sm py-1.5 px-3 rounded-md w-full max-w-md"
                  >
                    {remainingSlots.map((s) => (
                      <option key={s} value={s}>{CONTRACTOR_ADDENDUM_SLOT_LABEL[s]}</option>
                    ))}
                  </select>
                </div>
                {(!( doc.formData as ContractorAddendumFormData).positionLevel || !(doc.formData as ContractorAddendumFormData).baselinePayout) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {!(doc.formData as ContractorAddendumFormData).positionLevel && (
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Position Level</label>
                        <input value={positionLevelDraft} onChange={(e) => setPositionLevelDraft(e.target.value)} className="glass-input text-sm py-1.5 px-3 rounded-md" />
                      </div>
                    )}
                    {!(doc.formData as ContractorAddendumFormData).baselinePayout && (
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Guaranteed Minimum Baseline Payout ($/month)</label>
                        <input value={baselinePayoutDraft} inputMode="numeric" onChange={(e) => setBaselinePayoutDraft(e.target.value.replace(/[^\d.,]/g, ""))} className="glass-input text-sm py-1.5 px-3 rounded-md" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground mb-3">
              Review the agreement below, then sign as <span className="font-semibold">{CONTRACTOR_ADDENDUM_SLOT_LABEL[slot]}</span>.
            </p>

            <ContractorAddendumCanvas bytes={pdf?.bytes ?? null} renderOverlay={renderOverlay} />

            <div className="mt-3 flex flex-col gap-2 max-w-md">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Printed name</label>
              <input
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                className="glass-input text-sm py-1.5 px-3 rounded-md"
              />
            </div>

            <div className="flex items-center justify-center mt-2">
              <SignaturePadControls pad={sigPad} />
            </div>

            {error && (
              <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 mt-3">{error}</p>
            )}

            <button
              onClick={handleSign}
              disabled={signing}
              className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white mt-3 disabled:opacity-50"
            >
              {signing ? "Submitting…" : "Confirm & Sign"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
