import { useEffect, useMemo, useState } from "react";
import { X, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { Ticket } from "@/lib/ticketData";
import { getTicketVisits, getTicketParts, updateTicketPart, type UIPartRow } from "@/lib/supabase/tickets";
import {
  getTicketClaimDetails,
  upsertTicketClaimDetails,
  type TicketClaimDetails,
} from "@/lib/supabase/claimDetails";
import { TicketPhotos } from "@/components/TicketPhotos";
import { useAuth } from "@/lib/auth";
import { buildServicePowerClaimPayload } from "@/lib/servicePowerClaimPayload";

interface Props {
  ticket: Ticket;
  /** Ticket numbers in the same order as Need Claim List's current filtered view, for the ‹ › nav arrows. */
  ticketNumbers: string[];
  /** Called with the saved row so the parent's bulk claim-details map (Pre-Claim Status column) stays in sync without a full refetch. */
  onSaved: (ticketNo: string, details: TicketClaimDetails) => void;
  onNavigate: (ticketNo: string) => void;
  onClose: () => void;
}

const PRE_CLAIM_STATUSES = ["Holding", "Need Claim", "Claim Not Needed", "Claimed"];
// Same canonical list as the ticket detail page's own Part Transaction editor
// (ticket.$ticketNo.tsx) — duplicated here rather than shared, matching how
// it's already duplicated in PartTransactionManager.tsx and MobileTechApp.tsx.
const PART_STATUSES = [
  "Back Order", "Cancelled", "Claimed", "CX Home", "Cx Received", "Defective", "Dropship",
  "Hold for Estimation", "Hold for next vist", "In Review", "Lost", "Need PO",
  "Not Used & Stocked", "PAID", "Part Ready", "PNN", "PO Made", "RA - Defect",
  "RA- DMG", "RA - PNN", "RA - Qty Discrepancy", "SQT Received", "Tech Pickup",
  "Transfer to Another Ticket", "Used",
];
const MARKUP_OPTIONS = Array.from({ length: 21 }, (_, i) => i * 5);

function fmt(amount: number) {
  return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

const inputCls = "w-full bg-slate-800/50 border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none disabled:opacity-50";
const roCls = "w-full bg-slate-950/50 border border-white/5 rounded px-2 py-1.5 text-sm text-slate-300";
const labelCls = "block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}
function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <Field label={label}>
      <div className={roCls}>{value || "—"}</div>
    </Field>
  );
}

type FormState = Omit<TicketClaimDetails, "id" | "ticketId">;
const emptyForm = (): FormState => ({
  preClaimStatus: "", claimNote: "", dealerStockRepair: false, serviceContractNo: "",
  callStatus: "", postingDate: "", startDate: "", completeDate: "", repairCategory: "",
  repairLevel: "", serviceType: "", jobCode: "", repairType: "", diagnosticOnly: false,
  partsOnlyWarranty: false, failureDefectCode: "", resolutionCode: "", laborFee: 0,
  otherFee: 0, shippingFee: 0, extraMileFee: 0, mileageFee: 0, poAmount: 0,
  spClaimBatchNumber: "", spClaimSequenceNumber: "", spClaimStatusCode: "",
  spClaimStatusDescription: "", spSubmittedAt: "", spLastResponse: null,
});

/**
 * The "Pre-Claim Information" modal — opened from Need Claim List's Action
 * column. Modeled on the legacy EarlyRepair system's own Pre-Claim modal.
 * See src/lib/supabase/claimDetails.ts and migration 0135 for which fields
 * are newly persisted vs. read from the ticket/parts data that already existed.
 */
export function PreClaimModal({ ticket, ticketNumbers, onSaved, onNavigate, onClose }: Props) {
  const { displayName, email } = useAuth();
  const [form, setForm] = useState<FormState>(emptyForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [customerComplaint, setCustomerComplaint] = useState("");
  const [servicePerformed, setServicePerformed] = useState("");
  const [parts, setParts] = useState<UIPartRow[]>([]);
  const [checkedPartIds, setCheckedPartIds] = useState<Set<string>>(new Set());
  const [savingPartId, setSavingPartId] = useState<string | null>(null);
  const [submittingToSP, setSubmittingToSP] = useState(false);
  const [spMessage, setSpMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getTicketClaimDetails(ticket.ticketNo),
      getTicketVisits(ticket.ticketNo),
      getTicketParts(ticket.ticketNo),
    ])
      .then(([details, visits, partRows]) => {
        if (cancelled) return;
        setForm(details ? { ...emptyForm(), ...details } : emptyForm());
        // Latest visit (visits are returned newest-first) carries the
        // freshest Symptom(Cx)/Resolution text; fall back to the ticket's
        // own problem description if there's no visit yet.
        const latest = visits[0];
        setCustomerComplaint(latest?.symptomCx || ticket.problemDescription || "");
        setServicePerformed(latest?.resolution || "");
        setParts(partRows);
        setCheckedPartIds(new Set(partRows.map((p) => p.id)));
      })
      .catch((err) => console.error("Failed to load Pre-Claim data:", err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticket.ticketNo]);

  const currentIndex = ticketNumbers.indexOf(ticket.ticketNo);
  const goPrev = () => { if (currentIndex > 0) onNavigate(ticketNumbers[currentIndex - 1]); };
  const goNext = () => { if (currentIndex >= 0 && currentIndex < ticketNumbers.length - 1) onNavigate(ticketNumbers[currentIndex + 1]); };

  const markupPriceFor = (p: UIPartRow) => {
    const price = Number(p.partPrice) || 0;
    const pct = Number(p.markup) || 0;
    return price * (1 + pct / 100);
  };
  // Part Fee counts every part actually marked "Used" for the claim,
  // independent of the checkbox column below (which is just this table's
  // own local "included in the subtotal I'm looking at" toggle).
  const partFee = useMemo(
    () => parts.filter((p) => p.status === "Used").reduce((s, p) => s + markupPriceFor(p), 0),
    [parts]
  );
  const checkedTotal = useMemo(
    () => parts.filter((p) => checkedPartIds.has(p.id)).reduce((s, p) => s + markupPriceFor(p), 0),
    [parts, checkedPartIds]
  );
  const usedCount = parts.filter((p) => p.status === "Used").length;
  const claimTotal = form.laborFee + partFee + form.otherFee + form.shippingFee + form.extraMileFee + form.mileageFee;

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const saved = await upsertTicketClaimDetails(ticket.ticketNo, form, email || displayName || null);
      onSaved(ticket.ticketNo, saved);
      onClose();
    } catch (err) {
      alert(`Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  // Saves whatever's currently in the form (so a fee just typed in doesn't
  // get left behind), builds the claim entirely from that + the ticket's
  // own data (buildServicePowerClaimPayload — no manual re-entry), submits
  // it to ServicePower, and stores the returned batch/sequence/status back
  // onto this ticket's claim details so a later resubmission updates the
  // same claim instead of creating a duplicate.
  const handleSubmitToServicePower = async () => {
    setSubmittingToSP(true);
    setSpMessage(null);
    try {
      const saved = await upsertTicketClaimDetails(ticket.ticketNo, form, email || displayName || null);
      setForm((prev) => ({ ...prev, ...saved }));
      onSaved(ticket.ticketNo, saved);

      const { claim, warnings, error } = buildServicePowerClaimPayload(
        ticket, saved, parts, customerComplaint, servicePerformed, partFee,
      );
      if (error || !claim) {
        setSpMessage({ type: "error", text: error || "Could not build a claim from this ticket's data." });
        return;
      }

      const { submitClaim } = await import("@/lib/servicePowerApiClient");
      const response = await submitClaim([claim]);
      const result = response.claims?.[0];

      if (!result) {
        setSpMessage({
          type: "error",
          text: response.messages?.map((m) => m.message).join("; ") || "ServicePower returned no result for this claim.",
        });
        return;
      }

      const updated = await upsertTicketClaimDetails(ticket.ticketNo, {
        spClaimBatchNumber: result.claimBatchNumber != null ? String(result.claimBatchNumber) : "",
        spClaimSequenceNumber: result.claimSequenceNumber != null ? String(result.claimSequenceNumber) : "",
        spClaimStatusCode: result.claimStatusCode || "",
        spClaimStatusDescription: result.claimStatusDescription || "",
        spSubmittedAt: new Date().toISOString(),
        spLastResponse: response,
      }, email || displayName || null);
      setForm((prev) => ({ ...prev, ...updated }));
      onSaved(ticket.ticketNo, updated);

      const errorTexts = [
        ...(result.errors?.map((e) => e.errorDescription) ?? []),
        ...(result.messages?.map((m) => m.message) ?? []),
      ];
      const warnText = warnings.length > 0 ? ` (${warnings.join(" ")})` : "";

      if (result.claimResponseCode === "OK") {
        setSpMessage({
          type: errorTexts.length > 0 ? "error" : "success",
          text:
            `Submitted — ServicePower status: ${result.claimStatusDescription || result.claimStatusCode || "OK"}` +
            (errorTexts.length > 0 ? `. Needs correction: ${errorTexts.join("; ")}` : "") +
            warnText,
        });
      } else {
        setSpMessage({ type: "error", text: errorTexts.join("; ") || "ServicePower rejected this claim." });
      }
    } catch (err) {
      setSpMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to submit to ServicePower." });
    } finally {
      setSubmittingToSP(false);
    }
  };

  const togglePartChecked = (id: string) =>
    setCheckedPartIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handlePartFieldBlur = async (part: UIPartRow, field: keyof UIPartRow, value: string) => {
    if (part[field] === value) return;
    const updated = { ...part, [field]: value };
    setParts((prev) => prev.map((p) => (p.id === part.id ? updated : p)));
    setSavingPartId(part.id);
    try {
      // updateTicketPart writes every column from its input, so the full
      // (already-loaded) row must be sent, not just the one changed field.
      await updateTicketPart(part.id, updated);
    } catch (err) {
      alert(`Failed to save part: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingPartId(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-slate-900 border border-white/15 rounded-xl w-full max-w-[1400px] max-h-[92vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-slate-950 rounded-t-xl">
          <div className="flex items-center gap-3">
            <button onClick={goPrev} disabled={currentIndex <= 0} className="p-1.5 rounded text-slate-400 hover:text-white disabled:opacity-30" title="Previous ticket">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div>
              <p className="font-semibold text-white">Pre-Claim Information of {ticket.ticketNo}</p>
              <p className="text-xs text-slate-400">{currentIndex + 1} of {ticketNumbers.length}</p>
            </div>
            <button onClick={goNext} disabled={currentIndex < 0 || currentIndex >= ticketNumbers.length - 1} className="p-1.5 rounded text-slate-400 hover:text-white disabled:opacity-30" title="Next ticket">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSubmit}
              disabled={saving || loading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Submit Pre-Claim
            </button>
            <button
              onClick={handleSubmitToServicePower}
              disabled={submittingToSP || loading}
              title="Builds the claim from this ticket's own data (no retyping) and files it with ServicePower"
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition"
            >
              {submittingToSP && <Loader2 className="h-4 w-4 animate-spin" />}
              Submit to ServicePower
            </button>
            <button onClick={onClose} className="text-white/40 hover:text-white/80 transition">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 p-5 space-y-6">
            {spMessage && (
              <div
                className={`text-sm rounded-lg p-3 border whitespace-pre-wrap ${
                  spMessage.type === "success"
                    ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/30"
                    : "text-red-300 bg-red-500/10 border-red-500/30"
                }`}
              >
                {spMessage.text}
              </div>
            )}
            {!spMessage && form.spClaimBatchNumber && (
              <div className="text-xs text-slate-400 rounded-lg p-2.5 border border-white/10 bg-slate-800/30">
                Already on ServicePower — Batch {form.spClaimBatchNumber} / Seq {form.spClaimSequenceNumber}
                {form.spClaimStatusDescription ? ` — Status: ${form.spClaimStatusDescription}` : ""}
                {form.spSubmittedAt ? ` (last submitted ${new Date(form.spSubmittedAt).toLocaleString()})` : ""}.
                Submitting again updates this same claim.
              </div>
            )}
            {/* Ticket / Customer / Product info + Pictures */}
            <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <ReadOnly label="Ticket # (Claim #)" value={ticket.ticketNo} />
                <ReadOnly label="S/P Account" value={ticket.account || ""} />
                <ReadOnly label="REDO" value={ticket.redo || "N"} />
                <Field label="Pre-Claim Status">
                  <select value={form.preClaimStatus} onChange={(e) => setField("preClaimStatus", e.target.value)} className={inputCls}>
                    <option value="">— select —</option>
                    {PRE_CLAIM_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <ReadOnly label="Manufacture" value={ticket.manufacturer || ""} />
                <Field label="Service Contract #">
                  <input value={form.serviceContractNo} onChange={(e) => setField("serviceContractNo", e.target.value)} className={inputCls} />
                </Field>
                <ReadOnly label="Claim Company" value={ticket.claimCompany || ""} />
                <Field label="Dealer Stock Repair">
                  <select value={form.dealerStockRepair ? "Yes" : "No"} onChange={(e) => setField("dealerStockRepair", e.target.value === "Yes")} className={inputCls}>
                    <option>No</option>
                    <option>Yes</option>
                  </select>
                </Field>
                <ReadOnly label="Model Code" value={ticket.model || ""} />
                <ReadOnly label="Serial #" value={ticket.serial || ""} />
                <ReadOnly label="Purchase Date" value={ticket.purchaseDate || ""} />
                <ReadOnly label="Brand" value={ticket.manufacturer || ""} />
                <ReadOnly label="Cx First Name" value={ticket.firstName || ""} />
                <ReadOnly label="Cx Last Name" value={ticket.lastName || ""} />
                <ReadOnly label="Cx Address 1" value={ticket.address || ""} />
                <ReadOnly label="Cx Address 2" value={ticket.address2 || ""} />
                <ReadOnly label="Cx City" value={ticket.city || ""} />
                <ReadOnly label="Cx State/Zip" value={[ticket.state, ticket.zip].filter(Boolean).join(" / ")} />
                <ReadOnly label="Cx Cell Phone" value={ticket.phone || ""} />
                <ReadOnly label="Cx Home Phone" value={ticket.altPhone || ticket.secondPhone || ""} />
                <ReadOnly label="Cx Email" value={ticket.email || ""} />
                <Field label="Call Status">
                  <input value={form.callStatus} onChange={(e) => setField("callStatus", e.target.value)} className={inputCls} />
                </Field>
              </div>
              <div>
                <p className={labelCls}>Pictures</p>
                {/* Same category as the ticket detail page's own Attachments
                    section (ticket.$ticketNo.tsx) — deliberately NOT a
                    separate "claim" category, so Pre-Claim always shows the
                    exact same photos already on the ticket instead of an
                    empty, disconnected gallery. */}
                <TicketPhotos ticketNo={ticket.ticketNo} category="service" title="" uploadedBy={displayName || email || undefined} />
              </div>
            </div>

            {/* Dates + classification */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Posting Date">
                <input type="date" value={form.postingDate} onChange={(e) => setField("postingDate", e.target.value)} className={inputCls} />
              </Field>
              <Field label="Start Date">
                <input type="date" value={form.startDate} onChange={(e) => setField("startDate", e.target.value)} className={inputCls} />
              </Field>
              <Field label="Complete Date">
                <input type="date" value={form.completeDate} onChange={(e) => setField("completeDate", e.target.value)} className={inputCls} />
              </Field>
              <ReadOnly label="Warranty Flag" value={ticket.warranty || ""} />
              <Field label="Repair Category">
                <input value={form.repairCategory} onChange={(e) => setField("repairCategory", e.target.value)} className={inputCls} />
              </Field>
              <Field label="Repair Level">
                <input value={form.repairLevel} onChange={(e) => setField("repairLevel", e.target.value)} className={inputCls} />
              </Field>
              <Field label="Service Type">
                <input value={form.serviceType} onChange={(e) => setField("serviceType", e.target.value)} className={inputCls} />
              </Field>
              <Field label="Job Code">
                <input value={form.jobCode} onChange={(e) => setField("jobCode", e.target.value)} className={inputCls} />
              </Field>
              <Field label="Repair Type">
                <input value={form.repairType} onChange={(e) => setField("repairType", e.target.value)} className={inputCls} />
              </Field>
              <Field label="Diagnostic Only">
                <select value={form.diagnosticOnly ? "Yes" : "No"} onChange={(e) => setField("diagnosticOnly", e.target.value === "Yes")} className={inputCls}>
                  <option>No</option>
                  <option>Yes</option>
                </select>
              </Field>
              <Field label="Parts ONLY Warranty">
                <select value={form.partsOnlyWarranty ? "Yes" : "No"} onChange={(e) => setField("partsOnlyWarranty", e.target.value === "Yes")} className={inputCls}>
                  <option>No</option>
                  <option>Yes</option>
                </select>
              </Field>
              <Field label="Failure/Defect Code">
                <input value={form.failureDefectCode} onChange={(e) => setField("failureDefectCode", e.target.value)} className={inputCls} />
              </Field>
              <Field label="Resolution/Repair Code">
                <input value={form.resolutionCode} onChange={(e) => setField("resolutionCode", e.target.value)} className={inputCls} />
              </Field>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Customer Complaint">
                <div className={`${roCls} whitespace-pre-wrap min-h-[100px]`}>{customerComplaint || "—"}</div>
              </Field>
              <Field label="Service Performed">
                <div className={`${roCls} whitespace-pre-wrap min-h-[100px]`}>{servicePerformed || "—"}</div>
              </Field>
            </div>

            {/* Parts Used */}
            <div>
              <h3 className="text-center text-lg font-semibold text-white mb-1">Parts Used</h3>
              <p className="text-center text-xs text-slate-500 mb-3">Part Fee (Claim Amount, below) totals every part marked "Used" regardless of the checkboxes here — the checkboxes only control this table's own subtotal row.</p>
              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full text-xs min-w-[1100px]">
                  <thead>
                    <tr className="bg-white/5 border-b border-white/10 text-slate-400 uppercase">
                      <th className="px-2 py-2 w-8"></th>
                      <th className="px-2 py-2 text-left">Part No</th>
                      <th className="px-2 py-2 text-left">Qty</th>
                      <th className="px-2 py-2 text-left">Description</th>
                      <th className="px-2 py-2 text-left">Part Status</th>
                      <th className="px-2 py-2 text-left">Invoice No</th>
                      <th className="px-2 py-2 text-right">Part Price</th>
                      <th className="px-2 py-2 text-right">Ship Cost</th>
                      <th className="px-2 py-2 text-right">Markup %</th>
                      <th className="px-2 py-2 text-right">Markup Price</th>
                      <th className="px-2 py-2 text-left">Part Dist.</th>
                      <th className="px-2 py-2 text-left">Distributor #</th>
                      <th className="px-2 py-2 text-left">Job Code</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {parts.length === 0 ? (
                      <tr><td colSpan={13} className="px-3 py-6 text-center text-slate-500">No parts on this ticket.</td></tr>
                    ) : (
                      parts.map((p) => {
                        const saving = savingPartId === p.id;
                        return (
                          <tr key={p.id} className={p.status === "Used" ? "" : "opacity-80"}>
                            <td className="px-2 py-1.5 text-center">
                              <input type="checkbox" checked={checkedPartIds.has(p.id)} onChange={() => togglePartChecked(p.id)} className="accent-blue-500" />
                            </td>
                            <td className="px-2 py-1.5 text-blue-400 whitespace-nowrap">{p.partNo}</td>
                            <td className="px-2 py-1.5">{p.quantity}</td>
                            <td className="px-2 py-1.5">{p.partDesc}</td>
                            <td className="px-2 py-1.5">
                              <select
                                key={`status:${p.id}:${p.status}`}
                                defaultValue={p.status}
                                disabled={saving}
                                onBlur={(e) => handlePartFieldBlur(p, "status", e.target.value)}
                                onChange={(e) => handlePartFieldBlur(p, "status", e.target.value)}
                                className={`${inputCls} py-1`}
                              >
                                <option value="">—</option>
                                {PART_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </td>
                            <td className="px-2 py-1.5">{p.invoiceNo}</td>
                            <td className="px-2 py-1.5 text-right">
                              <input key={`price:${p.id}:${p.partPrice}`} defaultValue={p.partPrice} disabled={saving} onBlur={(e) => handlePartFieldBlur(p, "partPrice", e.target.value)} className={`${inputCls} py-1 text-right w-20`} />
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <input key={`ship:${p.id}:${p.shipCost}`} defaultValue={p.shipCost} disabled={saving} onBlur={(e) => handlePartFieldBlur(p, "shipCost", e.target.value)} className={`${inputCls} py-1 text-right w-20`} />
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <select
                                key={`markup:${p.id}:${p.markup}`}
                                defaultValue={p.markup || "0"}
                                disabled={saving}
                                onChange={(e) => handlePartFieldBlur(p, "markup", e.target.value)}
                                className={`${inputCls} py-1 text-right`}
                              >
                                {MARKUP_OPTIONS.map((v) => <option key={v} value={v}>{v}%</option>)}
                              </select>
                            </td>
                            <td className="px-2 py-1.5 text-right text-slate-200">{fmt(markupPriceFor(p))}</td>
                            <td className="px-2 py-1.5">
                              <input key={`dist:${p.id}:${p.partDist}`} defaultValue={p.partDist} disabled={saving} onBlur={(e) => handlePartFieldBlur(p, "partDist", e.target.value)} className={`${inputCls} py-1 w-24`} />
                            </td>
                            <td className="px-2 py-1.5">
                              <input key={`distno:${p.id}:${p.distributorNo}`} defaultValue={p.distributorNo} disabled={saving} onBlur={(e) => handlePartFieldBlur(p, "distributorNo", e.target.value)} className={`${inputCls} py-1 w-24`} />
                            </td>
                            <td className="px-2 py-1.5">
                              <input key={`jobcode:${p.id}:${p.jobCode}`} defaultValue={p.jobCode} disabled={saving} onBlur={(e) => handlePartFieldBlur(p, "jobCode", e.target.value)} className={`${inputCls} py-1 w-24`} />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  {parts.length > 0 && (
                    <tfoot>
                      <tr className="border-t border-white/20 bg-white/5 font-semibold">
                        <td colSpan={3} className="px-2 py-2 text-slate-300">TOTAL</td>
                        <td className="px-2 py-2 text-slate-300">{parts.length}</td>
                        <td className="px-2 py-2 text-slate-300">{usedCount} Used</td>
                        <td colSpan={4} />
                        <td className="px-2 py-2 text-right text-green-300">{fmt(checkedTotal)}</td>
                        <td colSpan={3} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* Claim Amount */}
            <div>
              <h3 className="text-center text-lg font-semibold text-white mb-3">Claim Amount</h3>
              <div className="grid md:grid-cols-3 gap-4 bg-slate-800/30 border border-white/10 rounded-lg p-4">
                <Field label="Labor Fee">
                  <input type="number" step="0.01" value={form.laborFee || ""} onChange={(e) => setField("laborFee", Number(e.target.value) || 0)} className={inputCls} placeholder="0.00" />
                </Field>
                <ReadOnly label="Part Fee" value={fmt(partFee)} />
                <Field label="Other Fee">
                  <input type="number" step="0.01" value={form.otherFee || ""} onChange={(e) => setField("otherFee", Number(e.target.value) || 0)} className={inputCls} placeholder="0.00" />
                </Field>
                <Field label="Shipping Fee">
                  <input type="number" step="0.01" value={form.shippingFee || ""} onChange={(e) => setField("shippingFee", Number(e.target.value) || 0)} className={inputCls} placeholder="0.00" />
                </Field>
                <Field label="Extra Mile Fee">
                  <input type="number" step="0.01" value={form.extraMileFee || ""} onChange={(e) => setField("extraMileFee", Number(e.target.value) || 0)} className={inputCls} placeholder="0.00" />
                </Field>
                <Field label="Mileage (round trip)">
                  <input type="number" step="0.01" value={form.mileageFee || ""} onChange={(e) => setField("mileageFee", Number(e.target.value) || 0)} className={inputCls} placeholder="0.00" />
                </Field>
                <Field label="PO Amount">
                  <input type="number" step="0.01" value={form.poAmount || ""} onChange={(e) => setField("poAmount", Number(e.target.value) || 0)} className={inputCls} placeholder="0.00" />
                </Field>
                <div className="md:col-span-2 flex items-end justify-end">
                  <div className="text-right">
                    <p className={labelCls}>Claim Total</p>
                    <p className="text-2xl font-bold text-green-300">{fmt(claimTotal)}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
