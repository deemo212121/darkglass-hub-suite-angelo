import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Printer } from "lucide-react";
import { LOCATIONS } from "@/lib/locations";
import { getPartReturns, updatePartReturnEntryRow, submitPartReturnBatch, type PartReturnRow } from "@/lib/supabase/partReturn";
import { marconeLookupPart, marconeRequestReturn, marconeGetReaQrCode, marconeFindReturnableItems, type MarconePartInfo } from "@/lib/marconeApi";
import { FloatingHorizontalScrollbar } from "@/components/FloatingHorizontalScrollbar";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { usePersistedTab } from "@/lib/usePersistedTab";

const STATUS_COLOR: Record<string, React.CSSProperties> = {
  Claimed: { background: "#d1fae5", color: "#065f46" },
  "PO Made": { background: "#fef3c7", color: "#92400e" },
  "Need PO": { background: "#fee2e2", color: "#991b1b" },
  "Part Ready": { background: "#d1fae5", color: "#065f46" },
  "Tech Pickup": { background: "#e0e7ff", color: "#3730a3" },
  "RA - PNN": { background: "#f3e8ff", color: "#6b21a8" },
  "In Review": { background: "#fef9c3", color: "#854d0e" },
  PNN: { background: "#f3e8ff", color: "#6b21a8" },
  Defective: { background: "#fee2e2", color: "#991b1b" },
  Used: { background: "#e5e7eb", color: "#374151" },
  Cancelled: { background: "#e5e7eb", color: "#6b7280" },
  "Not Used & Stocked": { background: "#e5e7eb", color: "#374151" },
  "Hold for next vist": { background: "#fef3c7", color: "#92400e" },
  "CX Home": { background: "#e5e7eb", color: "#374151" },
};

// Reuses the same reason vocabulary already established on the sibling
// Part Return Status page's RA-status suffixes (Defect/DMG/PNN/Qty
// Discrepancy), plus "Not Needed" from the training manual - not a
// fabricated taxonomy, just the real categories this app already uses.
const RETURN_REASONS = ["Not Needed", "Defect", "DMG", "PNN", "Qty Discrepancy"];

// Part Provider is a fixed, user-specified set of 4 buckets (not a
// dynamically-fetched list) that every real part_dist value gets grouped
// into - replaces the earlier separate "Part Dist." filter entirely.
const PROVIDER_OPTIONS = ["Marcone", "Encompass", "LG", "Other"];
function providerGroupOf(partDist: string): string {
  const d = (partDist || "").toLowerCase();
  if (d.includes("marcone")) return "Marcone";
  if (d.includes("encompass")) return "Encompass";
  if (d.includes("lg")) return "LG";
  return "Other";
}

function formatMoney(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatUsd(value: number | undefined): string {
  return typeof value === "number" ? `$${value.toFixed(2)}` : "—";
}

// "Inventory" bucket group, computed entirely from fields already on
// PartReturnRow - see the header comment in lib/supabase/partReturn.ts for
// why each one means what it means (Rec'd in particular is about the
// DISTRIBUTOR receiving the return, not us receiving the part).
function recdQty(r: PartReturnRow): number {
  return r.returnStatus !== "NOT RECEIVED" ? r.returnQty : 0;
}
function inReviewQty(r: PartReturnRow): number {
  return r.status === "In Review" ? r.quantity : 0;
}
function defectQty(r: PartReturnRow): number {
  return r.status === "Defective" ? r.quantity : 0;
}
function pnnQty(r: PartReturnRow): number {
  return r.status === "PNN" ? r.quantity : 0;
}
function currentQty(r: PartReturnRow): number {
  return Math.max(0, r.quantity - r.scanOutQty);
}
function reservedQty(_r: PartReturnRow): number {
  // Always 0 - no "earmarked vs. general stock" concept exists anywhere in
  // this schema (every parts row already always has a ticket_id). Shown
  // honestly as 0 rather than invented.
  return 0;
}
// Compact tag mirroring whichever Inventory bucket(s) are active on this
// row - not a real lot-tracking field (no such data exists), just a
// readable summary of the same status-driven buckets above.
function lotTag(r: PartReturnRow): string {
  const tags: string[] = [];
  const ir = inReviewQty(r);
  const d = defectQty(r);
  const p = pnnQty(r);
  if (ir > 0) tags.push(`In Review(${ir})`);
  if (d > 0) tags.push(`Defect(${d})`);
  if (p > 0) tags.push(`PNN(${p})`);
  return tags.join(" ");
}

function marconeAccountNumber(): string {
  const env = (import.meta as any).env || {};
  return String(env.VITE_MARCONE_ACCOUNT_NUMBER || env.VITE_MARCONE_CUST_NO || "").trim();
}

export function PartReturn({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [tab, setTab] = usePersistedTab<"return" | "core">(
    "ahs:part-return-active-tab",
    ["return", "core"],
    "return",
  );
  const [allRows, setAllRows] = useState<PartReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);

  const [provider, setProvider] = useState("");
  const [location, setLocation] = useState("");
  const [agingMin, setAgingMin] = useState(0);
  const [agingMax, setAgingMax] = useState(90);
  const [uniqueIdSearch, setUniqueIdSearch] = useState("");
  const [includeReturned, setIncludeReturned] = useState(false);
  const [includeReserved, setIncludeReserved] = useState(false);
  const [resultSearch, setResultSearch] = useState("");

  const [selectedForReturn, setSelectedForReturn] = useState<Set<string>>(new Set());
  const [showReturnConfirm, setShowReturnConfirm] = useState(false);
  const [submittingReturn, setSubmittingReturn] = useState(false);
  const [returnSubmitMessage, setReturnSubmitMessage] = useState<string | null>(null);

  const [modalPartNo, setModalPartNo] = useState("");
  const [modalTab, setModalTab] = useState<"encompass" | "marcone">("marcone");
  const [marconeInfo, setMarconeInfo] = useState<MarconePartInfo | null>(null);
  const [marconeLoading, setMarconeLoading] = useState(false);
  const [marconeNotFound, setMarconeNotFound] = useState(false);
  const [marconeError, setMarconeError] = useState<string | null>(null);

  const [raLabelRaNo, setRaLabelRaNo] = useState<string | null>(null);
  const [raLabelUrl, setRaLabelUrl] = useState<string | null>(null);
  const [raLabelLoading, setRaLabelLoading] = useState(false);
  const [raLabelError, setRaLabelError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    getPartReturns()
      .then(setAllRows)
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!modalPartNo) {
      setMarconeInfo(null);
      setMarconeError(null);
      setMarconeNotFound(false);
      return;
    }
    let cancelled = false;
    setMarconeLoading(true);
    setMarconeError(null);
    setMarconeNotFound(false);
    marconeLookupPart({ partNumber: modalPartNo })
      .then((result) => {
        if (cancelled) return;
        if (result.notFound) {
          setMarconeNotFound(true);
          setMarconeInfo(null);
          return;
        }
        if (!result.success) {
          setMarconeError(result.error || "Marcone lookup failed");
          return;
        }
        setMarconeInfo(result.data || null);
      })
      .catch((err) => { if (!cancelled) setMarconeError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setMarconeLoading(false); });
    return () => { cancelled = true; };
  }, [modalPartNo]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModalPartNo("");
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, []);

  const openPartInfoModal = (partNo: string) => {
    setModalPartNo(partNo);
    setModalTab("marcone");
  };

  const openRaLabel = async (raNo: string) => {
    setRaLabelRaNo(raNo);
    setRaLabelUrl(null);
    setRaLabelError(null);
    setRaLabelLoading(true);
    const raNum = Number(raNo);
    if (!raNum || Number.isNaN(raNum)) {
      setRaLabelError(`"${raNo}" isn't a Marcone RA number Marcone's label lookup can use.`);
      setRaLabelLoading(false);
      return;
    }
    const res = await marconeGetReaQrCode({ returnAuthorizationNumber: raNum });
    if (!res.success || !res.data) {
      setRaLabelError(res.error || "Failed to fetch RA label from Marcone");
    } else {
      setRaLabelUrl(res.data.imageUrl);
    }
    setRaLabelLoading(false);
  };
  const closeRaLabel = () => {
    if (raLabelUrl) URL.revokeObjectURL(raLabelUrl);
    setRaLabelRaNo(null);
    setRaLabelUrl(null);
    setRaLabelError(null);
  };

  // A return batch can only target one provider bucket at a time. Drop the
  // selection whenever Part Provider changes or is cleared.
  useEffect(() => {
    setSelectedForReturn(new Set());
  }, [provider, tab]);

  const setLocalField = (id: string, field: "raNo" | "raDate" | "returnReason", value: string) => {
    setAllRows((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  };
  const persistField = async (id: string, field: "raNo" | "raDate" | "returnReason", value: string) => {
    try {
      await updatePartReturnEntryRow(id, { [field]: value });
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save change");
    }
  };

  const setLocalReturnQty = (id: string, value: number) => {
    setAllRows((current) => current.map((row) => (row.id === id ? { ...row, returnQty: value } : row)));
  };
  const persistReturnQty = async (id: string, value: number) => {
    try {
      await updatePartReturnEntryRow(id, { returnQty: value });
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save return qty");
    }
  };

  const toggleSelectForReturn = (id: string) => {
    setSelectedForReturn((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedRows = useMemo(() => allRows.filter((r) => selectedForReturn.has(r.id)), [allRows, selectedForReturn]);
  const isMarconeDist = provider === "Marcone";

  // Pre-flight check, run whenever the confirm modal opens for a Marcone
  // batch: asks Marcone's own /returns/findreturnableitems whether it
  // actually recognizes each part as returnable BEFORE we call the real
  // requestreturnauthorization endpoint. Prefers PO # - confirmed against
  // real production data that our stored po_no matches Marcone's own PO
  // format exactly and returns one precise match. Falls back to bare part #
  // only if po_no is blank (a part # alone can match several unrelated
  // invoices for accounts that reorder the same part - real test returned
  // 6 different invoices for one part #, so it's a last resort, not
  // reliably precise to this specific row). Does NOT search by our stored
  // invoice_no - confirmed against real data that it carries a "-N"
  // line-item suffix ("74445360-1") that Marcone's own invoice numbers
  // don't have ("74445360"), so a raw invoice_no search reliably fails.
  const [marconeVerify, setMarconeVerify] = useState<Record<string, { loading: boolean; found: boolean; qtyAvailable?: number; error?: string }>>({});

  useEffect(() => {
    if (!showReturnConfirm || !isMarconeDist) return;
    let cancelled = false;
    setMarconeVerify(Object.fromEntries(selectedRows.map((r) => [r.id, { loading: true, found: false }])));
    selectedRows.forEach(async (r) => {
      const searchBy: "PO" | "Part" = r.poNo ? "PO" : "Part";
      const itemSearch = r.poNo || r.partNo;
      if (!itemSearch) {
        if (!cancelled) setMarconeVerify((prev) => ({ ...prev, [r.id]: { loading: false, found: false, error: "No PO # or part # to check" } }));
        return;
      }
      const res = await marconeFindReturnableItems({ searchBy, itemSearch });
      if (cancelled) return;
      if (!res.success) {
        // Confirmed against real data: Marcone answers a genuine "nothing
        // matches" with HTTP 400 + this exact message, not an empty 200
        // list - treat that as a clean "not found" (the interesting,
        // expected negative result this check exists for), not a technical
        // failure like a network/auth error.
        const notFound = (res.error || "").toLowerCase().includes("no returnable items found");
        setMarconeVerify((prev) => ({
          ...prev,
          [r.id]: notFound
            ? { loading: false, found: false }
            : { loading: false, found: false, error: res.error || "Lookup failed" },
        }));
        return;
      }
      const match = (res.data || []).find((it) => (it.partNumber || "").toLowerCase() === r.partNo.toLowerCase());
      setMarconeVerify((prev) => ({
        ...prev,
        [r.id]: match
          ? { loading: false, found: true, qtyAvailable: match.returnQuantityAvailable }
          : { loading: false, found: false },
      }));
    });
    return () => { cancelled = true; };
  }, [showReturnConfirm, isMarconeDist, selectedRows]);

  const submitReturn = async () => {
    setSubmittingReturn(true);
    setSaveError(null);
    try {
      if (isMarconeDist) {
        // Real Marcone return: one call per part line (the endpoint doesn't
        // accept a batch), collect per-row success/failure so one bad line
        // doesn't block the rest.
        const results = await Promise.allSettled(
          selectedRows.map(async (r) => {
            const res = await marconeRequestReturn({
              partNumber: r.partNo,
              quantity: r.returnQty || r.quantity,
              reason: r.returnReason || undefined,
              poNumber: r.poNo || undefined,
              invoiceNumber: r.invoiceNo || undefined,
              reference: r.ticketNo || undefined,
            });
            if (!res.success || !res.data?.returnAuthorizationNumber) {
              throw new Error(res.error || "Marcone returned no RA number");
            }
            const raNo = String(res.data.returnAuthorizationNumber);
            await updatePartReturnEntryRow(r.id, { raNo, raDate: new Date().toISOString().slice(0, 10) });
            return { id: r.id, raNo };
          })
        );
        const succeeded = results.filter((r): r is PromiseFulfilledResult<{ id: string; raNo: string }> => r.status === "fulfilled");
        const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
        if (succeeded.length > 0) {
          const raById = new Map(succeeded.map((r) => [r.value.id, r.value.raNo]));
          const today = new Date().toISOString().slice(0, 10);
          setAllRows((current) => current.map((row) =>
            raById.has(row.id) ? { ...row, raNo: raById.get(row.id)!, raDate: today } : row
          ));
        }
        if (failed.length === 0) {
          setReturnSubmitMessage(`Marcone issued ${succeeded.length} real RA number${succeeded.length !== 1 ? "s" : ""}.`);
          setSelectedForReturn(new Set());
          setShowReturnConfirm(false);
        } else {
          setSaveError(`${succeeded.length} succeeded, ${failed.length} failed: ${failed[0].reason instanceof Error ? failed[0].reason.message : String(failed[0].reason)}`);
          // Keep only the failed rows selected so the user can retry just those.
          const succeededIds = new Set(succeeded.map((r) => r.value.id));
          setSelectedForReturn((prev) => new Set(Array.from(prev).filter((id) => !succeededIds.has(id))));
        }
      } else {
        // No documented/wired return API for this distributor - record the
        // return locally only (stamps ra_date, doesn't fabricate an RA #).
        await submitPartReturnBatch(Array.from(selectedForReturn));
        const today = new Date().toISOString().slice(0, 10);
        setAllRows((current) => current.map((row) =>
          selectedForReturn.has(row.id) && !row.raDate ? { ...row, raDate: today } : row
        ));
        setReturnSubmitMessage(`Return recorded locally for ${selectedForReturn.size} part${selectedForReturn.size !== 1 ? "s" : ""} — ${provider} has no live return API wired up, so no real RA # was issued.`);
        setSelectedForReturn(new Set());
        setShowReturnConfirm(false);
      }
      window.setTimeout(() => setReturnSubmitMessage(null), 8000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to submit return");
    } finally {
      setSubmittingReturn(false);
    }
  };

  const byTab = useMemo(() => allRows.filter((r) => (tab === "core" ? r.coreValue > 0 : r.coreValue <= 0)), [allRows, tab]);

  const matchesCommonFilters = (r: PartReturnRow) => {
    if (provider && providerGroupOf(r.partDist) !== provider) return false;
    if (location && r.location !== location) return false;
    if (r.aging !== null && (r.aging < agingMin || r.aging > agingMax)) return false;
    if (!includeReturned && r.returnStatus !== "NOT RECEIVED") return false;
    if (!includeReserved && reservedQty(r) > 0) return false;
    if (uniqueIdSearch && !r.id.toLowerCase().includes(uniqueIdSearch.toLowerCase()) && !r.invoiceNo.toLowerCase().includes(uniqueIdSearch.toLowerCase())) return false;
    if (resultSearch) {
      const blob = [r.ticketNo, r.partNo, r.description, r.status, r.claimTo, r.raNo, r.repairStatus].join(" ").toLowerCase();
      if (!blob.includes(resultSearch.toLowerCase())) return false;
    }
    return true;
  };

  const rows = useMemo(
    () => byTab.filter((r) => matchesCommonFilters(r)),
    [byTab, provider, location, agingMin, agingMax, includeReturned, includeReserved, uniqueIdSearch, resultSearch]
  );

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <style>{`
          .pr-panel { background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 10px; padding: 1rem; color: #fff; backdrop-filter: blur(10px); width: 100%; min-width: 0; }
          .pr-panel + .pr-panel { margin-top: 0.9rem; }
          .controls-grid { display: grid; grid-template-columns: repeat(4, minmax(160px, 1fr)); gap: 0.75rem; margin-bottom: 0.7rem; }
          .field { display: flex; flex-direction: column; gap: 0.25rem; }
          .field label { font-size: 0.78rem; font-weight: 700; color: #e5e7eb; }
          .field label.required::after { content: " *"; color: #ef4444; }
          .inventory-subhead th { background: #e2e8f0; font-size: 0.72rem; color: #1f2937; }
          .lot-tag { font-size: 0.72rem; color: #6b7280; white-space: normal; }
          .ra-label-btn { border: 1px solid #cbd5e1; background: #fff; color: #1f2937; border-radius: 6px; padding: 0.18rem 0.4rem; cursor: pointer; font-size: 0.7rem; font-weight: 600; }
          .ra-label-btn:hover { background: #f1f5f9; }
          .field input, .field select { width: 100%; padding: 0.55rem 0.65rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(17, 24, 39, 0.95); color: #fff; font-size: 0.85rem; }
          .aging-range { display: flex; align-items: center; gap: 0.4rem; }
          .aging-range input { width: 70px; text-align: center; }
          .aging-range span { color: #dbeafe; font-weight: 700; font-size: 0.9rem; }
          .checkbox-row { display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; color: #e5e7eb; cursor: pointer; }
          .actions-row { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; margin-bottom: 0.7rem; justify-content: space-between; }
          .result-info { font-size: 0.84rem; font-weight: 600; color: #bfdbfe; }
          .search-input { padding: 0.45rem 0.65rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(17, 24, 39, 0.95); color: #fff; font-size: 0.84rem; min-width: 220px; }
          .tab-buttons { display: flex; gap: 0.75rem; margin-top: 1.1rem; margin-bottom: 1.1rem; }
          .tab-btn { padding: 0.75rem 1.75rem; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(255, 255, 255, 0.05); color: #fff; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 600; transition: background 0.15s ease, border-color 0.15s ease; }
          .tab-btn:hover { background: rgba(255, 255, 255, 0.1); }
          .tab-btn.active { background: #1d4ed8; border-color: #1d4ed8; }
          .tab-btn.active:hover { background: #1e40af; }
          .table-wrap { overflow-x: auto; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 8px; background: #fff; max-width: 100%; min-width: 0; }
          .pr-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; white-space: nowrap; }
          .pr-table thead tr { background: #1e3a5f; color: #fff; }
          .pr-table th { padding: 0.55rem 0.7rem; text-align: left; font-weight: 700; border-bottom: 2px solid #2563eb; white-space: nowrap; }
          .pr-table td { padding: 0.45rem 0.7rem; border-bottom: 1px solid #e5e7eb; color: #111827; vertical-align: middle; }
          .pr-table tbody tr:hover { background: #eff6ff; }
          .pr-table tbody tr:last-child td { border-bottom: none; }
          .ticket-link { color: #2563eb; text-decoration: none; font-weight: 600; }
          .ticket-link:hover { text-decoration: underline; }
          .part-link-btn { border: 0; background: transparent; padding: 0; margin: 0; font: inherit; color: #2563eb; font-weight: 600; text-decoration: none; cursor: pointer; }
          .part-link-btn:hover { text-decoration: underline; }
          .status-pill { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 999px; font-size: 0.72rem; font-weight: 700; white-space: nowrap; }
          .cell-input { width: 100%; min-width: 90px; padding: 0.25rem 0.4rem; border: 1px solid #d1d5db; border-radius: 4px; font-size: 0.78rem; color: #111827; }
          .money { text-align: right; }
          .part-info-modal-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); display: none; align-items: center; justify-content: center; z-index: 2200; padding: 1rem; }
          .part-info-modal-overlay.is-open { display: flex; }
          .part-info-modal { width: min(980px, calc(100vw - 2rem)); max-height: calc(100vh - 2rem); overflow: auto; background: #ffffff; border: 1px solid #d1d5db; border-radius: 12px; box-shadow: 0 28px 70px rgba(15, 23, 42, 0.3); }
          .part-info-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.9rem 1rem; border-bottom: 1px solid #e5e7eb; background: #f8fafc; }
          .part-info-title { font-size: 1rem; font-weight: 700; color: #111827; }
          .part-info-close { border: 1px solid #cbd5e1; background: #ffffff; color: #111827; border-radius: 8px; padding: 0.32rem 0.6rem; cursor: pointer; }
          .part-info-tabs { display: flex; gap: 0.45rem; padding: 0.75rem 1rem 0; }
          .part-info-tab-btn { border: 1px solid #cbd5e1; background: #ffffff; color: #1f2937; padding: 0.4rem 0.85rem; border-radius: 999px; cursor: pointer; font-size: 0.82rem; font-weight: 600; }
          .part-info-tab-btn.active { background: #0f172a; color: #ffffff; border-color: #0f172a; }
          .part-info-body { padding: 0.8rem 1rem 1rem; }
          .part-info-pane { display: none; }
          .part-info-pane.active { display: block; }
          .part-info-matrix { width: 100%; border-collapse: collapse; font-size: 0.79rem; margin-bottom: 0.85rem; color: #111827; }
          .part-info-matrix th, .part-info-matrix td { border: 1px solid #d1d5db; padding: 0.45rem; text-align: left; }
          .part-info-matrix thead th { background: #f3f4f6; font-weight: 700; }
          .part-info-section-title { font-size: 0.82rem; font-weight: 700; color: #111827; margin: 0.2rem 0 0.4rem; }
          .part-info-section-subtitle { font-size: 0.76rem; color: #4b5563; margin-bottom: 0.35rem; }
          .part-info-empty { padding: 0.7rem; border: 1px dashed #d1d5db; border-radius: 8px; font-size: 0.78rem; color: #6b7280; }
          #partInfoModalOverlay .part-info-tab-btn.active { color: #ffffff !important; }
          @media (max-width: 1100px) { .controls-grid { grid-template-columns: repeat(2, minmax(160px, 1fr)); } }
          @media (max-width: 700px) { .controls-grid { grid-template-columns: 1fr; } }
          @media print { .no-print { display: none !important; } }
        `}</style>

        <div className="flex items-center gap-3 mb-6 no-print">
          <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15"><ChevronLeft className="h-4 w-4" /></Link>
          <h1 className="text-2xl font-bold">{sub.title}</h1>
        </div>
        {saveError && <p className="text-sm text-red-400 mb-3 no-print">{saveError}</p>}

        <div className="pr-panel no-print">
          <div className="controls-grid">
            <div className="field">
              <label className="required" htmlFor="providerFilter">Part Provider</label>
              <select id="providerFilter" value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="">All Providers</option>
                {PROVIDER_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="locationFilter">Location</label>
              <select id="locationFilter" value={location} onChange={(e) => setLocation(e.target.value)}>
                <option value="">All Locations</option>
                {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Aging</label>
              <div className="aging-range">
                <input type="number" value={agingMin} onChange={(e) => setAgingMin(+e.target.value)} />
                <span>~</span>
                <input type="number" value={agingMax} onChange={(e) => setAgingMax(+e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="uniqueIdSearch">Unique ID / Invoice No</label>
              <input id="uniqueIdSearch" type="text" value={uniqueIdSearch} onChange={(e) => setUniqueIdSearch(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-4 mt-1">
            <label className="checkbox-row">
              <input type="checkbox" checked={includeReturned} onChange={(e) => setIncludeReturned(e.target.checked)} className="accent-blue-500" />
              Include Returned
            </label>
            <label className="checkbox-row" title="Reserved always reads 0 today — no 'earmarked vs. general stock' concept exists in this app yet.">
              <input type="checkbox" checked={includeReserved} onChange={(e) => setIncludeReserved(e.target.checked)} className="accent-blue-500" />
              Include Reserved
            </label>
            <button type="button" className="btn flex items-center gap-2 px-4" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" /> Print
            </button>
          </div>
        </div>

        <div className="tab-buttons no-print">
          <button type="button" className={`tab-btn ${tab === "return" ? "active" : ""}`} onClick={() => setTab("return")}>Part Return</button>
          <button type="button" className={`tab-btn ${tab === "core" ? "active" : ""}`} onClick={() => setTab("core")}>Core Part Return</button>
        </div>

        <div className="pr-panel">
          <div className="actions-row no-print">
            <div className="result-info">{rows.length} record{rows.length !== 1 ? "s" : ""} found</div>
            <div className="flex items-center gap-3">
              {returnSubmitMessage && <span className="text-sm font-semibold text-green-300">{returnSubmitMessage}</span>}
              {provider ? (
                <button
                  type="button"
                  className="btn px-4 bg-blue-600 hover:bg-blue-700 border-blue-600"
                  disabled={selectedForReturn.size === 0}
                  style={selectedForReturn.size === 0 ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
                  onClick={() => setShowReturnConfirm(true)}
                >
                  Return {provider} {selectedForReturn.size > 0 ? `(${selectedForReturn.size})` : ""}
                </button>
              ) : (
                <span className="text-xs text-muted-foreground">Select a Part Provider to process returns</span>
              )}
              <input className="search-input" type="text" placeholder="search in result" value={resultSearch} onChange={(e) => setResultSearch(e.target.value)} />
            </div>
          </div>

          {loadError ? (
            <p className="text-sm text-red-400 px-2 py-6">Failed to load part returns: {loadError}</p>
          ) : loading ? (
            <p className="text-sm text-muted-foreground px-2 py-6">Loading…</p>
          ) : (
          <>
          <div ref={tableScrollRef} className="table-wrap">
            <table className="pr-table min-w-max">
              {tab === "return" ? (
                <>
                  <thead>
                    <tr>
                      <th rowSpan={2}>Account #</th>
                      <th rowSpan={2}>Unique ID</th>
                      <th rowSpan={2}>Part #</th>
                      <th rowSpan={2}>Description</th>
                      <th rowSpan={2}>Lot #</th>
                      <th colSpan={6}>Inventory</th>
                      <th rowSpan={2}>Reserved Ticket #</th>
                      <th rowSpan={2}>Part Status</th>
                      <th rowSpan={2}>Invoice Date</th>
                      <th rowSpan={2}>Aging</th>
                      <th rowSpan={2}>Reason</th>
                      <th rowSpan={2}>Return Qty</th>
                      <th rowSpan={2}>RA #</th>
                      <th rowSpan={2}>RA Label</th>
                      <th rowSpan={2}>Return</th>
                    </tr>
                    <tr className="inventory-subhead">
                      <th>Rec'd</th>
                      <th>In-Review</th>
                      <th>Defect</th>
                      <th>PNN</th>
                      <th>Current</th>
                      <th>Reserved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><td colSpan={20} className="text-center py-8 text-muted-foreground">No records found.</td></tr>
                    ) : rows.map((r) => (
                      <tr key={r.id}>
                        <td>{providerGroupOf(r.partDist) === "Marcone" ? (marconeAccountNumber() || "—") : "—"}</td>
                        <td title={r.id}>{r.id.slice(0, 8)}</td>
                        <td>
                          <button type="button" className="part-link-btn" onClick={() => openPartInfoModal(r.partNo)}>{r.partNo}</button>
                        </td>
                        <td>{r.description || "—"}</td>
                        <td className="lot-tag">{lotTag(r) || "—"}</td>
                        <td className="money">{recdQty(r)}</td>
                        <td className="money">{inReviewQty(r)}</td>
                        <td className="money">{defectQty(r)}</td>
                        <td className="money">{pnnQty(r)}</td>
                        <td className="money">{currentQty(r)}</td>
                        <td className="money">{reservedQty(r)}</td>
                        <td>
                          {r.ticketNo ? (
                            <Link className="ticket-link" to="/ticket/$ticketNo" params={{ ticketNo: r.ticketNo }} target="_blank" rel="noreferrer">{r.ticketNo}</Link>
                          ) : "—"}
                        </td>
                        <td><span className="status-pill" style={STATUS_COLOR[r.status] || {}}>{r.status || "—"}</span></td>
                        <td>{r.invoiceDate || "—"}</td>
                        <td className="money">{r.aging === null ? "—" : r.aging}</td>
                        <td>
                          <select
                            className="cell-input"
                            value={r.returnReason}
                            onChange={(e) => { setLocalField(r.id, "returnReason", e.target.value); persistField(r.id, "returnReason", e.target.value); }}
                          >
                            <option value="">—</option>
                            {RETURN_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                          </select>
                        </td>
                        <td>
                          <input
                            className="cell-input"
                            type="number"
                            min={0}
                            max={r.quantity}
                            value={r.returnQty}
                            onChange={(e) => setLocalReturnQty(r.id, Number(e.target.value))}
                            onBlur={(e) => persistReturnQty(r.id, Number(e.target.value))}
                          />
                        </td>
                        <td>
                          <input
                            className="cell-input"
                            type="text"
                            placeholder="RA #"
                            value={r.raNo}
                            onChange={(e) => setLocalField(r.id, "raNo", e.target.value)}
                            onBlur={(e) => persistField(r.id, "raNo", e.target.value)}
                          />
                        </td>
                        <td>
                          {providerGroupOf(r.partDist) === "Marcone" && r.raNo ? (
                            <button type="button" className="ra-label-btn" onClick={() => openRaLabel(r.raNo)}>Label</button>
                          ) : "—"}
                        </td>
                        <td>
                          {provider ? (
                            <label className="flex items-center gap-1.5 whitespace-nowrap cursor-pointer">
                              <input type="checkbox" className="accent-blue-500" checked={selectedForReturn.has(r.id)} onChange={() => toggleSelectForReturn(r.id)} />
                              <span className="text-xs">Return {provider}</span>
                            </label>
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </>
              ) : (
                <>
                  <thead>
                    <tr>
                      <th>Ticket No.</th>
                      <th>Unique ID</th>
                      <th>Part #</th>
                      <th>Description</th>
                      <th>Invoice Date</th>
                      <th>Return Qty</th>
                      <th>Core Value</th>
                      <th>Part Status</th>
                      <th>Schedule Date</th>
                      <th>Technician</th>
                      <th>Core RA #</th>
                      <th>Return</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><td colSpan={12} className="text-center py-8 text-muted-foreground">No records found.</td></tr>
                    ) : rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.ticketNo ? (
                            <Link className="ticket-link" to="/ticket/$ticketNo" params={{ ticketNo: r.ticketNo }} target="_blank" rel="noreferrer">{r.ticketNo}</Link>
                          ) : "—"}
                        </td>
                        <td title={r.id}>{r.id.slice(0, 8)}</td>
                        <td>
                          <button type="button" className="part-link-btn" onClick={() => openPartInfoModal(r.partNo)}>{r.partNo}</button>
                        </td>
                        <td>{r.description || "—"}</td>
                        <td>{r.invoiceDate || "—"}</td>
                        <td>
                          <input
                            className="cell-input"
                            type="number"
                            min={0}
                            max={r.quantity}
                            value={r.returnQty}
                            onChange={(e) => setLocalReturnQty(r.id, Number(e.target.value))}
                            onBlur={(e) => persistReturnQty(r.id, Number(e.target.value))}
                          />
                        </td>
                        <td className="money">{r.coreValue > 0 ? formatMoney(r.coreValue) : "—"}</td>
                        <td><span className="status-pill" style={STATUS_COLOR[r.status] || {}}>{r.status || "—"}</span></td>
                        <td>{r.scheduleDate || "—"}</td>
                        <td>{r.technician || "—"}</td>
                        <td>
                          <input
                            className="cell-input"
                            type="text"
                            placeholder="Core RA #"
                            value={r.raNo}
                            onChange={(e) => setLocalField(r.id, "raNo", e.target.value)}
                            onBlur={(e) => persistField(r.id, "raNo", e.target.value)}
                          />
                        </td>
                        <td>
                          {provider ? (
                            <label className="flex items-center gap-1.5 whitespace-nowrap cursor-pointer">
                              <input type="checkbox" className="accent-blue-500" checked={selectedForReturn.has(r.id)} onChange={() => toggleSelectForReturn(r.id)} />
                              <span className="text-xs">Return {provider}</span>
                            </label>
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </>
              )}
            </table>
          </div>
          <FloatingHorizontalScrollbar targetRef={tableScrollRef} />
          </>
          )}
        </div>
      </main>

      <div className={`part-info-modal-overlay ${showReturnConfirm ? "is-open" : ""}`} onClick={(event) => {
        if (event.target === event.currentTarget && !submittingReturn) setShowReturnConfirm(false);
      }}>
        <div className="part-info-modal" role="dialog" aria-modal="true" aria-labelledby="returnConfirmTitle">
          <div className="part-info-header">
            <div id="returnConfirmTitle" className="part-info-title">Confirm Return to {provider}</div>
            <button type="button" className="part-info-close" onClick={() => setShowReturnConfirm(false)} disabled={submittingReturn}>Close</button>
          </div>
          <div className="part-info-body">
            <p style={{ fontSize: "0.85rem", color: "#374151", marginBottom: "0.75rem" }}>
              {isMarconeDist ? (
                <>{selectedRows.length} part{selectedRows.length !== 1 ? "s" : ""} will be submitted to <strong>Marcone's real return API</strong> — each will get back a genuine RA # from Marcone, saved into {tab === "core" ? "Core RA #" : "RA #"}.</>
              ) : (
                <>{selectedRows.length} part{selectedRows.length !== 1 ? "s" : ""} will be marked as returned to <strong>{provider}</strong> in our own system only — {provider} has no live return API wired up here, so no real RA # will be issued.</>
              )}
            </p>
            <table className="part-info-matrix">
              <thead>
                <tr>
                  <th>Part #</th><th>Description</th><th>Reason</th><th>Return Qty</th>
                  {isMarconeDist && <th>Marcone Confirms</th>}
                </tr>
              </thead>
              <tbody>
                {selectedRows.map((r) => {
                  const verify = marconeVerify[r.id];
                  return (
                    <tr key={r.id}>
                      <td>{r.partNo || "—"}</td>
                      <td>{r.description || "—"}</td>
                      <td>{r.returnReason || "—"}</td>
                      <td>{r.returnQty}</td>
                      {isMarconeDist && (
                        <td>
                          {!verify || verify.loading ? (
                            <span style={{ color: "#6b7280" }}>Checking…</span>
                          ) : verify.error ? (
                            <span style={{ color: "#b91c1c" }} title={verify.error}>Check failed</span>
                          ) : verify.found ? (
                            <span style={{ color: "#15803d", fontWeight: 700 }}>✓ {verify.qtyAvailable} returnable</span>
                          ) : (
                            <span style={{ color: "#b91c1c", fontWeight: 700 }} title="Marcone has no record of this part on this invoice/PO — double-check it was actually ordered from Marcone.">✗ Not found</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {isMarconeDist && (
              <p style={{ fontSize: "0.78rem", color: "#6b7280", marginTop: "-0.5rem", marginBottom: "0.75rem" }}>
                "Marcone Confirms" is a real, read-only check against Marcone's own returnable-items records — it does not create anything. A "Not found" doesn't block the return, but means Marcone's system doesn't recognize this part as coming from them; worth confirming before submitting.
              </p>
            )}
            <div style={{ display: "flex", gap: "0.6rem", marginTop: "1rem", justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setShowReturnConfirm(false)} disabled={submittingReturn}>Cancel</button>
              <button type="button" className="btn bg-blue-600 hover:bg-blue-700 border-blue-600" onClick={submitReturn} disabled={submittingReturn}>
                {submittingReturn ? "Submitting…" : `Return ${provider}`}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div id="partInfoModalOverlay" className={`part-info-modal-overlay ${modalPartNo ? "is-open" : ""}`} onClick={(event) => {
        if (event.target === event.currentTarget) setModalPartNo("");
      }}>
        <div className="part-info-modal" role="dialog" aria-modal="true" aria-labelledby="partInfoTitle">
          <div className="part-info-header">
            <div id="partInfoTitle" className="part-info-title">{modalPartNo ? `Part Info. of (${modalPartNo})` : "Part Info. of ()"}</div>
            <button type="button" className="part-info-close" onClick={() => setModalPartNo("")}>Close</button>
          </div>

          <div className="part-info-tabs">
            <button type="button" className={`part-info-tab-btn ${modalTab === "encompass" ? "active" : ""}`} onClick={() => setModalTab("encompass")}>Encompass</button>
            <button type="button" className={`part-info-tab-btn ${modalTab === "marcone" ? "active" : ""}`} onClick={() => setModalTab("marcone")}>Marcone</button>
          </div>

          <div className="part-info-body">
            <div className={`part-info-pane ${modalTab === "encompass" ? "active" : ""}`}>
              <div className="part-info-empty">No Encompass part-lookup API is wired into this app yet.</div>
            </div>

            <div className={`part-info-pane ${modalTab === "marcone" ? "active" : ""}`}>
              {marconeLoading ? (
                <div className="part-info-empty">Looking up {modalPartNo} on Marcone…</div>
              ) : marconeError ? (
                <div className="part-info-empty">Marcone lookup failed: {marconeError}</div>
              ) : marconeNotFound ? (
                <div className="part-info-empty">Marcone has no record of part {modalPartNo}.</div>
              ) : marconeInfo ? (
                <>
                  <table className="part-info-matrix">
                    <thead>
                      <tr><th>Field</th><th>Value</th><th>Field</th><th>Value</th></tr>
                    </thead>
                    <tbody>
                      <tr><td>Make</td><td>{marconeInfo.make || "—"}</td><td>Part #</td><td>{marconeInfo.partNumber || modalPartNo}</td></tr>
                      <tr><td>Net Price</td><td>{formatUsd(marconeInfo.netPrice)}</td><td>List Price</td><td>{formatUsd(marconeInfo.listPrice)}</td></tr>
                      <tr><td>Core Value</td><td>{formatUsd(marconeInfo.coreValue)}</td><td>Discontinued?</td><td>{marconeInfo.isDiscontinued ? "Yes" : "No"}</td></tr>
                      <tr><td>Description</td><td colSpan={3}>{marconeInfo.description || "—"}</td></tr>
                    </tbody>
                  </table>
                  <div className="part-info-section-title">Availability (Marcone)</div>
                  <div className="part-info-section-subtitle">
                    {marconeInfo.totalAvailable ?? 0} available across {(marconeInfo.inventory || []).length} warehouse(s)
                  </div>
                  {(marconeInfo.inventory || []).length === 0 ? (
                    <div className="part-info-empty">No stock currently available.</div>
                  ) : (
                    <table className="part-info-matrix">
                      <thead><tr><th>Warehouse</th><th>Available Qty</th></tr></thead>
                      <tbody>
                        {marconeInfo.inventory!.map((inv, i) => (
                          <tr key={i}><td>{inv.warehouseName || "—"}</td><td>{inv.quantityAvailable ?? 0}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              ) : (
                <div className="part-info-empty">No lookup performed yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className={`part-info-modal-overlay ${raLabelRaNo ? "is-open" : ""}`} onClick={(event) => {
        if (event.target === event.currentTarget) closeRaLabel();
      }}>
        <div className="part-info-modal" role="dialog" aria-modal="true" aria-labelledby="raLabelTitle" style={{ width: "min(420px, calc(100vw - 2rem))" }}>
          <div className="part-info-header">
            <div id="raLabelTitle" className="part-info-title">RA Label — {raLabelRaNo}</div>
            <button type="button" className="part-info-close" onClick={closeRaLabel}>Close</button>
          </div>
          <div className="part-info-body" style={{ textAlign: "center" }}>
            {raLabelLoading ? (
              <div className="part-info-empty">Fetching real QR label from Marcone…</div>
            ) : raLabelError ? (
              <div className="part-info-empty">Marcone label lookup failed: {raLabelError}</div>
            ) : raLabelUrl ? (
              <img src={raLabelUrl} alt={`RA ${raLabelRaNo} label`} style={{ maxWidth: "100%" }} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
