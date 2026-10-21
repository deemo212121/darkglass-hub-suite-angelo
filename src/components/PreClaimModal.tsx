import { useEffect, useMemo, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { Ticket } from "@/lib/ticketData";
import { getTicketVisits, getTicketParts, updateTicketFields, updateTicketPart, updateTicketStatus, type UIPartRow } from "@/lib/supabase/tickets";
import {
  getTicketClaimDetails,
  getReadyToCompleteDate,
  upsertTicketClaimDetails,
  type TicketClaimDetails,
} from "@/lib/supabase/claimDetails";
import { TicketPhotos } from "@/components/TicketPhotos";
import { PhotoSidePreview } from "@/components/PhotoSidePreview";
import { jobCodesFor } from "@/lib/jobCodes";
import type { TicketPhoto } from "@/lib/firebase/storage";
import { useAuth } from "@/lib/auth";
import { getMyProfileId } from "@/lib/supabase/users";
import { buildServicePowerClaimPayload, isClaimablePart } from "@/lib/servicePowerClaimPayload";
import { isWrongManufacturerName, spClaimLookupNames } from "@/lib/spClaimLookup";

interface Props {
  ticket: Ticket;
  /** Ticket numbers in the same order as Need Claim List's current filtered view, for the ‹ › nav arrows. */
  ticketNumbers: string[];
  /** Called with the saved row so the parent's bulk claim-details map (Pre-Claim Status column) stays in sync without a full refetch. */
  onSaved: (ticketNo: string, details: TicketClaimDetails) => void;
  /** The ticket's status changed here (a clean ServicePower submission sets CL-Claimed) — lets the list update its row. */
  onStatusChanged?: (ticketNo: string, status: string) => void;
  /** Model / serial edited here and saved onto the ticket — lets the list update its row. */
  onTicketUpdated?: (ticketNo: string, patch: { model: string; serial: string }) => void;
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
const sectionCls = "text-sm font-semibold text-blue-300 border-b border-white/10 pb-1 mb-3";

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
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
  spPaidTotal: null, spPaidLabor: null, spPaidParts: null, spPaidShipping: null, spPaidMileage: null,
  spPaidOther: null, spPaidTax: null, spPaymentDate: "", spReceivedDate: "", spClaimCheckedAt: "", updatedAt: "",
});

/** ServicePower rejecting the manufacturer / service center number pair — shown in plain words. The usual cause is the wrong service center number (our SP login GSL00002 instead of the call's own Service Center), not a locked account — see buildServicePowerClaimPayload. */
const SP_ACCOUNT_REJECTION = /invalid manufacturerName\s*\/\s*serviceCenterNumber/i;

/**
 * The "Pre-Claim Information" modal — opened from Need Claim List's Action
 * column. Modeled on the legacy EarlyRepair system's own Pre-Claim modal.
 * See src/lib/supabase/claimDetails.ts and migration 0135 for which fields
 * are newly persisted vs. read from the ticket/parts data that already existed.
 */
export function PreClaimModal({ ticket, ticketNumbers, onSaved, onStatusChanged, onTicketUpdated, onNavigate, onClose }: Props) {
  const { uid, displayName, email } = useAuth();
  // ticket_claim_details.updated_by is a uuid FK into profiles(id) — NOT
  // the caller's email/display name (those are plain text and Postgres
  // rejects them with "invalid input syntax for type uuid" on save, which
  // is exactly what was happening here before this fix).
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    getMyProfileId(uid).then((id) => { if (!cancelled) setMyProfileId(id); });
    return () => { cancelled = true; };
  }, [uid]);
  const [form, setForm] = useState<FormState>(emptyForm());
  /** Photo shown in the right-side preview panel (opened by clicking a picture); closed when the ticket changes. */
  const [sidePreview, setSidePreview] = useState<{ photos: TicketPhoto[]; index: number } | null>(null);
  useEffect(() => { setSidePreview(null); setConfirmSpSubmit(false); }, [ticket.ticketNo]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [customerComplaint, setCustomerComplaint] = useState("");
  const [servicePerformed, setServicePerformed] = useState("");
  // The latest visit's own Service Performed text — what an unedited claim uses.
  const [visitServicePerformed, setVisitServicePerformed] = useState("");
  const [spDefect, setSpDefect] = useState<{ state: "loading" | "ok" | "none"; text?: string; problemType?: string } | null>(null);
  // The newest visit log entry, shown in full so the claim can be checked
  // against what the tech actually recorded. `latestVisitNo` is its V#.
  const [latestVisit, setLatestVisit] = useState<Awaited<ReturnType<typeof getTicketVisits>>[number] | null>(null);
  const [latestVisitNo, setLatestVisitNo] = useState(0);
  const [parts, setParts] = useState<UIPartRow[]>([]);
  const [checkedPartIds, setCheckedPartIds] = useState<Set<string>>(new Set());
  const [savingPartId, setSavingPartId] = useState<string | null>(null);
  const [submittingToSP, setSubmittingToSP] = useState(false);
  // "Are you sure?" step before a claim is filed with ServicePower.
  const [confirmSpSubmit, setConfirmSpSubmit] = useState(false);
  // Model Code / Serial # — editable here (the rating plate is often in the
  // photos), saved onto the ticket itself with Submit Pre-Claim / Submit to
  // ServicePower through the same updateTicketFields the ticket page's Edit
  // Product Info uses (which also keeps the ServicePower sync from
  // overwriting them), and sent on the claim.
  const [modelCode, setModelCode] = useState(ticket.model || "");
  const [serialNo, setSerialNo] = useState(ticket.serial || "");
  useEffect(() => {
    setModelCode(ticket.model || "");
    setSerialNo(ticket.serial || "");
  }, [ticket.ticketNo, ticket.model, ticket.serial]);
  const saveProductEdits = async () => {
    const model = modelCode.trim();
    const serial = serialNo.trim();
    if (model === (ticket.model || "").trim() && serial === (ticket.serial || "").trim()) return;
    await updateTicketFields(ticket.ticketNo, { model, serial });
    onTicketUpdated?.(ticket.ticketNo, { model, serial });
  };
  const [spMessage, setSpMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const currentTicketRef = useRef(ticket.ticketNo);
  currentTicketRef.current = ticket.ticketNo;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSpDefect(null);
    Promise.all([
      getTicketClaimDetails(ticket.ticketNo),
      getTicketVisits(ticket.ticketNo),
      getTicketParts(ticket.ticketNo),
      getReadyToCompleteDate(ticket.ticketNo),
    ])
      .then(([details, visits, partRows, readyToCompleteDate]) => {
        if (cancelled) return;
        const loaded = details ? { ...emptyForm(), ...details } : emptyForm();
        // Complete Date fills in from the day the ticket's status last
        // turned to "CL-Ready to Complete" (status history).
        if (!loaded.completeDate && readyToCompleteDate) loaded.completeDate = readyToCompleteDate;
        // Posting Date fills in automatically (today, Central time) when the
        // claim doesn't have one yet — still editable, saved on submit.
        if (!loaded.postingDate) loaded.postingDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
        // Start Date fills in from the FIRST visit (V1 — the oldest, last in
        // this newest-first list): its schedule date, else the day it was logged.
        if (!loaded.startDate && visits.length > 0) {
          const first = visits[visits.length - 1];
          const iso = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "");
          loaded.startDate =
            iso(first.scheduleDate) ||
            (first.timestamp && !Number.isNaN(Date.parse(first.timestamp))
              ? new Date(first.timestamp).toLocaleDateString("en-CA", { timeZone: "America/Chicago" })
              : "");
        }
        setForm(loaded);
        // Latest visit (visits are returned newest-first) carries the
        // freshest Symptom(Cx)/Resolution text; fall back to the ticket's
        // own problem description if there's no visit yet.
        const latest = visits[0];
        setLatestVisit(latest ?? null);
        setLatestVisitNo(visits.length);
        setCustomerComplaint(latest?.symptomCx || ticket.problemDescription || "");
        // Service Performed: Claims' saved edit if there is one, else the
        // latest visit's own text.
        setVisitServicePerformed(latest?.resolution || "");
        setServicePerformed(details?.servicePerformed || latest?.resolution || "");
        setParts(partRows);
        partJobCodesToSave.current.clear();
        setCheckedPartIds(new Set(partRows.map((p) => p.id)));
        void pullDefectFromSP(true);
      })
      .catch((err) => console.error("Failed to load Pre-Claim data:", err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticket.ticketNo]);

  // Defect info from ServicePower: looks this ticket's call up by call number
  // (getCallInfoSearch) and reads the call's ProblemType + ProbelmDesc. SP's
  // dispatch feed has no EIA defect code — ProblemType is a text category
  // (e.g. "Leaking Water") — so it's SHOWN under the field and only goes in
  // when someone clicks "Use" (the claim's code field is 4 characters max).
  // `auto` = the silent lookup on open: a miss shows nothing.
  const pullDefectFromSP = async (auto = false) => {
    const forTicket = ticket.ticketNo;
    setSpDefect({ state: "loading" });
    try {
      const { fetchServicePowerCalls } = await import("@/lib/servicePowerSync");
      const res = await fetchServicePowerCalls({ callNo: forTicket });
      // Navigated to another ticket while this was in flight — drop it.
      if (currentTicketRef.current !== forTicket) return;
      const call = (res.calls ?? []).find((c: any) => String(c?.callNumber ?? "").trim() === forTicket) ?? res.calls?.[0];
      if (!res.success || !call) {
        setSpDefect({ state: "none", text: auto ? "" : "Not found on ServicePower." });
        return;
      }
      // ServicePower writes "None" when the call has no problem type — not a code to offer.
      const rawProblemType = String(call.problemType ?? "").trim();
      const problemType = /^none$/i.test(rawProblemType) ? "" : rawProblemType;
      const problemDesc = String(call.problemDesc ?? "").trim();
      if (!problemType && !problemDesc) {
        setSpDefect({ state: "none", text: auto ? "" : "ServicePower has no problem type on this call." });
        return;
      }
      setSpDefect({ state: "ok", problemType, text: `ServicePower: ${problemType || "—"}${problemDesc ? ` · "${problemDesc}"` : ""}` });
    } catch (err) {
      if (currentTicketRef.current !== forTicket) return;
      setSpDefect({ state: "none", text: auto ? "" : `ServicePower lookup failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  // What to save: the form, plus Service Performed only when it differs
  // from the visit's own text (or clears a previous edit) — an unedited
  // claim never writes that column, so saving works before migration 0330.
  const claimFieldsToSave = (): Partial<FormState> => {
    // What ServicePower paid (migration 0397) is read back by the paid-claim
    // check / Claim List Sync Status, never edited here — left out of the save.
    const {
      servicePerformed: savedEdit,
      spPaidTotal: _pt, spPaidLabor: _pl, spPaidParts: _pp, spPaidShipping: _ps, spPaidMileage: _pm,
      spPaidOther: _po, spPaidTax: _tx, spPaymentDate: _pd, spReceivedDate: _rd, spClaimCheckedAt: _ca,
      ...rest
    } = form;
    const edited = servicePerformed.trim() !== visitServicePerformed.trim() ? servicePerformed : "";
    if (edited || savedEdit) return { ...rest, servicePerformed: edited };
    return rest;
  };

  const currentIndex = ticketNumbers.indexOf(ticket.ticketNo);
  const goPrev = () => { if (currentIndex > 0) onNavigate(ticketNumbers[currentIndex - 1]); };
  const goNext = () => { if (currentIndex >= 0 && currentIndex < ticketNumbers.length - 1) onNavigate(ticketNumbers[currentIndex + 1]); };

  const markupPriceFor = (p: UIPartRow) => {
    const price = Number(p.partPrice) || 0;
    const pct = Number(p.markup) || 0;
    return price * (1 + pct / 100);
  };
  // Part Fee counts every part marked "Used" or "Claimed" for the claim
  // (isClaimablePart), independent of the checkbox column below (which is
  // just this table's own local "included in the subtotal I'm looking at"
  // toggle).
  const partFee = useMemo(
    () => parts.filter(isClaimablePart).reduce((s, p) => s + markupPriceFor(p), 0),
    [parts]
  );
  const checkedTotal = useMemo(
    () => parts.filter((p) => checkedPartIds.has(p.id)).reduce((s, p) => s + markupPriceFor(p), 0),
    [parts, checkedPartIds]
  );
  const usedCount = parts.filter(isClaimablePart).length;
  // Job Code dropdown / Defect Code rules for this ticket's claim company or manufacturer (lib/jobCodes.ts).
  const jobCodeRule = jobCodesFor(ticket.account, ticket.claimCompany, ticket.manufacturer, (ticket as { brand?: string | null }).brand);
  const claimTotal = form.laborFee + partFee + form.otherFee + form.shippingFee + form.extraMileFee + form.mileageFee;

  // Checked in the "Submit this claim to ServicePower?" window before
  // anything is sent. `required` = what ServicePower has sent claims back
  // for: "Blank Request Date" on any claim; "Blank Parts Invoice Number" /
  // "Blank Job Code" on GE claims; "Blank/Invalid Defect code" on non-GE
  // claims (a Frigidaire claim was sent back for it, two GE claims without
  // one weren't) — the submit waits until they're filled.
  // `blank` = anything else the claim would carry empty — listed, and the
  // person has to choose "Submit anyway". `rejectedParts` = parts
  // ServicePower refused on the last submission that are still on the claim.
  const spChecks = useMemo(() => {
    const isBlank = (v: unknown) => !String(v ?? "").trim();
    const required: string[] = [];
    const blank: string[] = [];
    const isGe = jobCodeRule?.key === "ge";
    // Named the way the form shows them (jobCodes.ts): Electrolux's defect
    // code sits in the Job Code spot, SQT / Assurant have their own labels.
    const defectInJobSpot = jobCodeRule?.field === "failureDefectCode";
    const defectLabel = defectInJobSpot ? `${jobCodeRule!.fieldLabel} (where the Job Code usually is)` : "Failure/Defect Code";
    const jobCodeLabel = jobCodeRule && !defectInJobSpot ? jobCodeRule.fieldLabel : "Job Code";
    const code = form.failureDefectCode.trim();
    if (!code) {
      if (isGe) blank.push("Failure/Defect Code");
      else required.push(`${defectLabel} — ServicePower sends a claim back without one.`);
    } else if (code.length > 4) required.push(`${defectLabel} "${code}" — enter the code itself (4 characters at most).`);
    const claimable = parts.filter(isClaimablePart);
    const noInvoice = claimable.filter((p) => isBlank(p.invoiceNo)).map((p) => p.partNo || "(no part #)");
    if (noInvoice.length) {
      if (isGe) required.push(`Invoice # on part ${noInvoice.join(", ")} — ServicePower needs one on every part.`);
      else blank.push(`Invoice # on part ${noInvoice.join(", ")}`);
    }
    const noJobCode = claimable.filter((p) => isBlank(p.jobCode)).map((p) => p.partNo || "(no part #)");
    // Electrolux / Frigidaire claims have no Job Code box (the spot holds the defect code).
    if (!defectInJobSpot && isBlank(form.jobCode) && (noJobCode.length || claimable.length === 0)) {
      if (isGe) required.push(`Job Code (Claim section)${noJobCode.length ? ` — none on part ${noJobCode.join(", ")} either` : ""}.`);
      else blank.push(jobCodeLabel);
    }
    if (isBlank(ticket.callReceivedDate)) required.push("Call received date on the ticket — it's sent as the request date.");

    if (isBlank(form.resolutionCode)) blank.push("Resolution/Repair Code");
    if (isBlank(form.repairCategory)) blank.push("Repair Category");
    if (isBlank(form.startDate)) blank.push("Start Date");
    if (isBlank(form.completeDate)) blank.push("Complete Date");
    if (isBlank(customerComplaint)) blank.push("Customer complaint (defect description)");
    if (isBlank(servicePerformed)) blank.push("Service Performed");
    if (!form.laborFee) blank.push("Labor Fee ($0)");
    if (isBlank(modelCode)) blank.push("Model Code");
    if (isBlank(serialNo)) blank.push("Serial #");
    if (isBlank(ticket.purchaseDate)) blank.push("Purchase Date");
    if (isBlank(ticket.firstName) && isBlank(ticket.lastName)) blank.push("Customer name");
    const noAddress = [["address", "address"], ["city", "city"], ["state", "state"], ["zip", "ZIP"], ["phone", "phone"]]
      .filter(([k]) => isBlank((ticket as any)[k]))
      .map(([, label]) => label);
    if (noAddress.length) blank.push(`Customer ${noAddress.join(", ")}`);

    const lastErrors: Array<{ partNumber?: string; errorDescription?: string }> =
      ((form.spLastResponse as any)?.claims?.[0]?.errors as any[]) ?? [];
    const rejectedParts = lastErrors
      .filter((e) => e.partNumber && claimable.some((p) => p.partNo === e.partNumber))
      .map((e) => `Part ${e.partNumber}: "${e.errorDescription}"`);
    return { required, blank, rejectedParts };
  }, [form, parts, ticket, customerComplaint, servicePerformed, modelCode, serialNo]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // The claim's Job Code is the one ServicePower gets (claim and every part
  // line — servicePowerClaimPayload.ts), so picking it fills the parts' Job
  // Code below too. Those parts are saved with Submit Pre-Claim / Submit to
  // ServicePower, like the rest of the form.
  const partJobCodesToSave = useRef<Set<string>>(new Set());
  const setClaimJobCode = (value: string) => {
    setField("jobCode", value);
    const code = value.trim();
    if (!code) return;
    setParts((prev) =>
      prev.map((p) => {
        if ((p.jobCode || "") === code) return p;
        partJobCodesToSave.current.add(p.id);
        return { ...p, jobCode: code };
      }),
    );
  };
  const savePartJobCodes = async () => {
    const ids = partJobCodesToSave.current;
    if (ids.size === 0) return;
    for (const p of parts.filter((x) => ids.has(x.id))) await updateTicketPart(p.id, p);
    ids.clear();
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const saved = await upsertTicketClaimDetails(ticket.ticketNo, claimFieldsToSave(), myProfileId);
      onSaved(ticket.ticketNo, saved);
      await saveProductEdits();
      await savePartJobCodes();
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
    if (spChecks.required.length > 0) return;
    setConfirmSpSubmit(false);
    setSubmittingToSP(true);
    setSpMessage(null);
    try {
      const saved = await upsertTicketClaimDetails(ticket.ticketNo, claimFieldsToSave(), myProfileId);
      setForm((prev) => ({ ...prev, ...saved }));
      await saveProductEdits();
      await savePartJobCodes();
      onSaved(ticket.ticketNo, saved);

      // The claim's serviceCenterNumber is the call's own ServiceCenter on
      // ServicePower (the servicer number the manufacturer issued us), read
      // fresh from the call — see buildServicePowerClaimPayload.
      let spServiceCenter = "";
      let spManufacturerName = "";
      try {
        const { fetchServicePowerCalls } = await import("@/lib/servicePowerSync");
        const res = await fetchServicePowerCalls({ callNo: ticket.ticketNo });
        const call = (res.calls ?? []).find((c: any) => String(c?.callNumber ?? "").trim() === ticket.ticketNo) ?? res.calls?.[0];
        spServiceCenter = String(call?.serviceCenter ?? "").trim();
        // The name ServicePower files this call's claims under for that
        // service center: the appliance brand for GE / Frigidaire calls, the
        // warranty company for e.g. Square Trade ("GENERAL ELECTRIC" with
        // Square Trade's GSL38018 is refused). Checked with the read-only
        // claim lookup — brand first, so what already works stays the same —
        // then the call's claim company, then its brand.
        if (spServiceCenter) {
          const { retrieveClaim } = await import("@/lib/servicePowerApiClient");
          const names = Array.from(new Set([String(ticket.manufacturer ?? "").trim().toUpperCase(), ...spClaimLookupNames(call?.mfgId, ticket.ticketNo, null, call?.product?.brandDesc)].filter(Boolean)));
          for (const name of names) {
            const probe = await retrieveClaim({ manufacturerName: name, serviceCenterNumber: spServiceCenter, claimNumber: ticket.ticketNo });
            const message = (probe?.messages ?? []).map((m) => m.message).join("; ");
            if (!isWrongManufacturerName(message)) {
              spManufacturerName = name;
              break;
            }
          }
        }
      } catch (err) {
        console.warn("[PreClaim] couldn't read the call's Service Center from ServicePower:", err);
      }

      const { claim, warnings, error } = buildServicePowerClaimPayload(
        { ...ticket, model: modelCode.trim(), serial: serialNo.trim() }, saved, parts, customerComplaint, servicePerformed, partFee, spServiceCenter, spManufacturerName,
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
      }, myProfileId);
      setForm((prev) => ({ ...prev, ...updated }));
      onSaved(ticket.ticketNo, updated);

      const errorTexts = [
        ...(result.errors?.map((e) => (e.partNumber ? `${e.errorDescription} (part ${e.partNumber})` : e.errorDescription)) ?? []),
        ...(result.messages?.map((m) => m.message) ?? []),
      ];
      const warnText = warnings.length > 0 ? ` (${warnings.join(" ")})` : "";

      if (result.claimResponseCode === "OK") {
        // ServicePower has the claim → the ticket is CL-Claimed in AHS too,
        // even when it comes back needing corrections ("Incomplete",
        // "Servicer to Correct") — ServicePower marks the call CLAIMED the
        // same way, and the corrections are resubmitted onto the same claim.
        // A ticket already CL-Claimed, or closed after payment, stays as is.
        let statusNote = "";
        const currentStatus = String(ticket.status ?? "").trim().toLowerCase();
        if (currentStatus !== "cl-claimed" && currentStatus !== "cl-data-closed" && currentStatus !== "cl-data closed") {
          try {
            await updateTicketStatus(ticket.ticketNo, "CL-Claimed");
            onStatusChanged?.(ticket.ticketNo, "CL-Claimed");
            statusNote = " Ticket status set to CL-Claimed.";
          } catch (statusErr) {
            statusNote = ` (Couldn't set the ticket to CL-Claimed: ${statusErr instanceof Error ? statusErr.message : "unknown error"} — set it on the ticket page.)`;
          }
        }
        setSpMessage({
          type: errorTexts.length > 0 ? "error" : "success",
          text:
            `Submitted — ServicePower status: ${result.claimStatusDescription || result.claimStatusCode || "OK"}` +
            (errorTexts.length > 0 ? `. Needs correction: ${errorTexts.join("; ")}.` : ".") +
            statusNote +
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

  /** The Failure/Defect Code field with Pull from SP — under its own label, or in the Job Code slot for Electrolux. */
  const renderDefectField = (label: React.ReactNode = "Failure/Defect Code") => (
                <Field label={label}>
                  <div className="flex gap-1.5">
                    <input value={form.failureDefectCode} onChange={(e) => setField("failureDefectCode", e.target.value)} className={inputCls} />
                    <button
                      type="button"
                      onClick={() => void pullDefectFromSP(false)}
                      disabled={spDefect?.state === "loading"}
                      title="Look this call up on ServicePower again"
                      className="shrink-0 rounded border border-blue-400/40 bg-blue-500/15 px-2 text-[11px] font-semibold text-blue-200 hover:bg-blue-500/25 disabled:opacity-50"
                    >
                      {spDefect?.state === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Pull from SP"}
                    </button>
                  </div>
                  {spDefect?.text && (
                    <p className={`mt-1 text-[10px] ${spDefect.state === "ok" ? "text-emerald-300" : "text-slate-500"}`}>
                      {spDefect.text}
                      {spDefect.state === "ok" && spDefect.problemType && form.failureDefectCode !== spDefect.problemType && (
                        <button
                          type="button"
                          onClick={() => setField("failureDefectCode", spDefect.problemType!)}
                          className="ml-1.5 font-semibold text-blue-400 hover:text-blue-300"
                          title="ServicePower's claim defect code is 4 characters max — longer text is cut off when submitting"
                        >
                          Use
                        </button>
                      )}
                    </p>
                  )}
                </Field>
  );

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`bg-slate-900 border border-white/15 rounded-xl w-full ${sidePreview ? "max-w-[98vw]" : "max-w-[1400px]"} max-h-[92vh] flex flex-col shadow-2xl transition-[max-width] duration-200`}
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
              onClick={() => setConfirmSpSubmit(true)}
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

        {confirmSpSubmit && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={() => setConfirmSpSubmit(false)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="sp-submit-confirm-title"
              className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-white/10 bg-slate-900 p-5 text-left shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setConfirmSpSubmit(false); } }}
            >
              <h3 id="sp-submit-confirm-title" className="text-lg font-bold text-white">Submit this claim to ServicePower?</h3>
              <p className="mt-1 text-sm text-slate-300">
                {form.spClaimBatchNumber
                  ? <>This updates the claim already on ServicePower (Batch {form.spClaimBatchNumber} / Seq {form.spClaimSequenceNumber}).</>
                  : <>This files the claim with ServicePower.</>}
              </p>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2 text-sm">
                <dt className="text-slate-400">Ticket</dt>
                <dd className="font-mono text-white">{ticket.ticketNo}</dd>
                <dt className="text-slate-400">Customer</dt>
                <dd className="text-white">{[ticket.firstName, ticket.lastName].filter(Boolean).join(" ") || "—"}</dd>
                <dt className="text-slate-400">Manufacturer</dt>
                <dd className="text-white">{ticket.manufacturer || "—"}</dd>
                <dt className="text-slate-400">Claim Total</dt>
                <dd className="font-semibold text-green-300">{fmt(claimTotal)}</dd>
              </dl>
              {spChecks.required.length > 0 && (
                <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  <p className="font-semibold">ServicePower will send this claim back — fill these in first:</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {spChecks.required.map((m) => <li key={m}>{m}</li>)}
                  </ul>
                </div>
              )}
              {spChecks.rejectedParts.length > 0 && (
                <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  <p className="font-semibold">ServicePower refused these on the last submission:</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {spChecks.rejectedParts.map((m) => <li key={m}>{m}</li>)}
                  </ul>
                  <p className="mt-1">Check the part number and the full model number (with its version digit) before sending again.</p>
                </div>
              )}
              {spChecks.blank.length > 0 && (
                <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  <p className="font-semibold">These would go to ServicePower blank:</p>
                  <p className="mt-1">{spChecks.blank.join(" · ")}</p>
                </div>
              )}
              <p className="mt-2 text-xs text-amber-300">Any changes on this form are saved first. Once ServicePower has the claim, the ticket is set to CL-Claimed (corrections go back onto the same claim).</p>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button type="button" autoFocus onClick={() => setConfirmSpSubmit(false)} className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-600">
                  {spChecks.required.length > 0 ? "Go back and fill them in" : "Cancel"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSubmitToServicePower()}
                  disabled={spChecks.required.length > 0}
                  title={spChecks.required.length > 0 ? "Fill in the fields listed in red first" : undefined}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {spChecks.blank.length > 0 || spChecks.rejectedParts.length > 0 ? "Submit anyway" : "Yes, submit to ServicePower"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Form on the left; a clicked photo opens in the preview panel on the right. */}
        <div className="flex min-h-0 flex-1">
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
                {/* ServicePower's account-pair rejection, in plain words; its original text stays below, small. */}
                {spMessage.type === "error" && SP_ACCOUNT_REJECTION.test(spMessage.text) ? (
                  <>
                    <span className="font-semibold">ServicePower didn't accept the service center number sent with this claim. Try Submit to ServicePower again — if it keeps happening, contact the person responsible for ServicePower.</span>
                    <span className="mt-1 block text-[11px] text-red-300/70">SP: {spMessage.text}</span>
                  </>
                ) : (
                  spMessage.text
                )}
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
              <div className="space-y-5">
              <div>
              <h3 className={sectionCls}>Claim</h3>
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
                <Field label="Call Status">
                  <input value={form.callStatus} onChange={(e) => setField("callStatus", e.target.value)} className={inputCls} />
                </Field>
              </div>
              </div>

              <div>
              <h3 className={sectionCls}>Product Details</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <ReadOnly label="Manufacture" value={ticket.manufacturer || ""} />
                <ReadOnly label="Brand" value={ticket.manufacturer || ""} />
                <Field label="Model Code">
                  <input value={modelCode} onChange={(e) => setModelCode(e.target.value)} className={inputCls} placeholder="Model #" />
                </Field>
                <Field label="Serial #">
                  <input value={serialNo} onChange={(e) => setSerialNo(e.target.value)} className={inputCls} placeholder="Serial #" />
                </Field>
                <ReadOnly label="Purchase Date" value={ticket.purchaseDate || ""} />
              </div>
              </div>

              <div>
              <h3 className={sectionCls}>Customer Details</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <ReadOnly label="Cx First Name" value={ticket.firstName || ""} />
                <ReadOnly label="Cx Last Name" value={ticket.lastName || ""} />
                <ReadOnly label="Cx Address 1" value={ticket.address || ""} />
                <ReadOnly label="Cx Address 2" value={ticket.address2 || ""} />
                <ReadOnly label="Cx City" value={ticket.city || ""} />
                <ReadOnly label="Cx State/Zip" value={[ticket.state, ticket.zip].filter(Boolean).join(" / ")} />
                <ReadOnly label="Cx Cell Phone" value={ticket.phone || ""} />
                <ReadOnly label="Cx Home Phone" value={ticket.altPhone || ticket.secondPhone || ""} />
                <ReadOnly label="Cx Email" value={ticket.email || ""} />
              </div>
              </div>
              </div>
              <div>
                <p className={labelCls}>Pictures</p>
                {/* Same category as the ticket detail page's own Attachments
                    section (ticket.$ticketNo.tsx) — deliberately NOT a
                    separate "claim" category, so Pre-Claim always shows the
                    exact same photos already on the ticket instead of an
                    empty, disconnected gallery. */}
                <TicketPhotos
                  ticketNo={ticket.ticketNo}
                  category="service"
                  title=""
                  uploadedBy={displayName || email || undefined}
                  onPhotoClick={(photo, all) => setSidePreview({ photos: all, index: Math.max(0, all.findIndex((p) => p.fullPath === photo.fullPath)) })}
                />
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
              {(() => {
                // Electrolux: this slot is the Defect Code (what ServicePower asks Electrolux / Frigidaire claims for).
                if (jobCodeRule?.field === "failureDefectCode") return renderDefectField(<>{jobCodeRule.fieldLabel} <span className="ml-1 normal-case tracking-normal font-semibold text-emerald-400">· {jobCodeRule.label} defect code</span></>);
                // A dropdown of the claim company's / manufacturer's job codes when we have a list (lib/jobCodes.ts).
                const list = jobCodeRule;
                if (!list || list.codes.length === 0) {
                  return (
                    <Field label="Job Code">
                      <input value={form.jobCode} onChange={(e) => setClaimJobCode(e.target.value)} className={inputCls} />
                    </Field>
                  );
                }
                const known = list.codes.map((c) => c.code);
                const picked = list.codes.find((c) => c.code === form.jobCode);
                return (
                  <div>
                    {/* Same label line as every other field — the green note sits beside it so the grid stays aligned. */}
                    <label className={labelCls}>
                      {list.fieldLabel} <span className="ml-1 normal-case tracking-normal font-semibold text-emerald-400">· {list.label} job code</span>
                    </label>
                    {/* The open list shows each code with its description; the closed box shows only the
                        code (the native select sits on top with its own text hidden), the description goes underneath. */}
                    <div className="relative">
                      <div className={`${inputCls} pointer-events-none flex items-center justify-between gap-2`} aria-hidden="true">
                        <span className={form.jobCode ? "" : "text-slate-500"}>{form.jobCode || "— select —"}</span>
                        <span className="text-slate-500 text-[10px]">▼</span>
                      </div>
                    <select value={form.jobCode} onChange={(e) => setClaimJobCode(e.target.value)} className="absolute inset-0 w-full h-full cursor-pointer appearance-none bg-transparent text-transparent [&>option]:bg-slate-900 [&>option]:text-white" title={picked?.note ? `${picked.code} — ${picked.note}` : form.jobCode}>
                      <option value="">— select —</option>
                      {list.codes.map((c) => (
                        <option key={c.code} value={c.code}>{c.note ? `${c.code} — ${c.note}` : c.code}</option>
                      ))}
                      {form.jobCode && !known.includes(form.jobCode) && (
                        <option value={form.jobCode}>{`${form.jobCode} (not a ${list.label} code)`}</option>
                      )}
                    </select>
                    </div>
                    {picked?.note && <p className="mt-1 text-[10px] text-slate-400">{picked.note}</p>}
                    {form.jobCode && !picked && <p className="mt-1 text-[10px] text-amber-300">Not a {list.label} code</p>}
                  </div>
                );
              })()}
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
              {jobCodeRule?.field !== "failureDefectCode" && renderDefectField()}
              <Field label="Resolution/Repair Code">
                <input value={form.resolutionCode} onChange={(e) => setField("resolutionCode", e.target.value)} className={inputCls} />
              </Field>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Customer Complaint">
                <div className={`${roCls} whitespace-pre-wrap min-h-[100px]`}>{customerComplaint || "—"}</div>
              </Field>
              <Field label="Service Performed">
                <textarea
                  value={servicePerformed}
                  onChange={(e) => setServicePerformed(e.target.value)}
                  rows={5}
                  className={`${inputCls} min-h-[100px] resize-y`}
                  placeholder="What was done on the repair"
                />
                <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
                  {servicePerformed.trim() !== visitServicePerformed.trim() ? (
                    <>
                      <span className="text-amber-300">Edited for this claim — the visit log is unchanged.</span>
                      <button type="button" onClick={() => setServicePerformed(visitServicePerformed)} className="text-blue-400 hover:text-blue-300">
                        Reset to visit's text
                      </button>
                    </>
                  ) : (
                    <span>From the latest visit. Edits save with the claim.</span>
                  )}
                </div>
              </Field>
            </div>

            {/* Latest visit log entry — everything the tech/CSR recorded on it. */}
            <div>
              <h3 className={sectionCls}>
                Latest Visit Log{latestVisit ? ` — V${latestVisitNo}` : ""}
              </h3>
              {!latestVisit ? (
                <p className="text-sm text-slate-500">No visits logged on this ticket yet.</p>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <ReadOnly label="Schedule Date" value={[latestVisit.scheduleDate, latestVisit.timeSlot].filter(Boolean).join(" · ")} />
                    <ReadOnly label="Technician" value={[latestVisit.technician, latestVisit.secondTechnician].filter(Boolean).join(" + ")} />
                    <ReadOnly label="Repair Status" value={latestVisit.repairStatus || latestVisit.status || ""} />
                    <ReadOnly label="Repair Type" value={latestVisit.repairType || ""} />
                    <ReadOnly label="Action Type (CSR)" value={latestVisit.actionType || ""} />
                    <ReadOnly label="Activity" value={latestVisit.activity || ""} />
                    <ReadOnly
                      label="Last Updated"
                      value={latestVisit.updatedAt || latestVisit.timestamp ? new Date(latestVisit.updatedAt || latestVisit.timestamp).toLocaleString() : ""}
                    />
                    <ReadOnly label="Logged By" value={latestVisit.by || ""} />
                  </div>
                  <div className="grid md:grid-cols-2 gap-3">
                    <Field label="Cause of Failure (Tech)">
                      <div className={`${roCls} whitespace-pre-wrap`}>{latestVisit.diagnosis || "—"}</div>
                    </Field>
                    <Field label="Non-Completion Reason">
                      <div className={`${roCls} whitespace-pre-wrap`}>{latestVisit.nonCompletionReason || "—"}</div>
                    </Field>
                    {latestVisit.schedNotes && (
                      <Field label="Sched Notes">
                        <div className={`${roCls} whitespace-pre-wrap`}>{latestVisit.schedNotes}</div>
                      </Field>
                    )}
                    {latestVisit.note && (
                      <Field label="Internal Note">
                        <div className={`${roCls} whitespace-pre-wrap`}>{latestVisit.note}</div>
                      </Field>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Parts Used */}
            <div>
              <h3 className="text-center text-lg font-semibold text-white mb-1">Parts Used</h3>
              <p className="text-center text-xs text-slate-500 mb-3">Part Fee (Claim Amount, below) totals every part marked "Used" or "Claimed" regardless of the checkboxes here — the checkboxes only control this table's own subtotal row.</p>
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
                          <tr key={p.id} className={isClaimablePart(p) ? "" : "opacity-80"}>
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
                        <td className="px-2 py-2 text-slate-300">{usedCount} Used/Claimed</td>
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
        {sidePreview && (
          <PhotoSidePreview
            photos={sidePreview.photos}
            index={sidePreview.index}
            onIndexChange={(i) => setSidePreview((prev) => (prev ? { ...prev, index: i } : prev))}
            onClose={() => setSidePreview(null)}
          />
        )}
        </div>
      </div>
    </div>
  );
}
