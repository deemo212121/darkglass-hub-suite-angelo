/**
 * HR Paperworks → General → Promotion Paper and Wage Increase. HR fills the
 * letter (employee, starting salary, effective next payroll, salary
 * increase), picks who signs as Senior / Executive, and sends it. It then
 * moves through Senior → Executive → HR → Employee on its own — see
 * SignCompensationUpdatePage.tsx and compensationUpdateBridge.ts. The HR step
 * has no pre-picked signer: any HR user signs it here from the Sent list.
 *
 * Self-contained (own data fetch) rather than more state inside
 * ReportHRDaily.tsx, same pattern as ExceptionReportsTab.tsx.
 */
import { useEffect, useMemo, useState } from "react";
import { Copy, Download, Eye, Loader2, PenLine, Send, Trash2, XCircle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getCompanyUsers, getMyProfileId, type ProfileRow } from "@/lib/supabase/users";
import {
  createSignableDocument,
  getSignableDocuments,
  reassignSignableDocument,
  confirmSignableDocument,
  cancelSignableDocument,
  deleteSignableDocument,
  signDocument,
  type SignableDocument,
} from "@/lib/supabase/signableDocuments";
import { uploadCompensationUpdate, uploadSignableDocumentSignature, refreshStorageAuthToken } from "@/lib/firebase/storage";
import { captureHtmlToPdfBlob, loadAssetDataUrl, resolveSignaturesForCapture } from "@/lib/pdfCapture";
import {
  buildCompensationUpdateBodyMarkup,
  compensationUpdateStyles,
  COMPENSATION_SLOT_LABEL,
  compensationSigningOrder,
  nextCompensationSlot,
  compensationSignRequestMessage,
  type CompensationSignatureSlot,
  type CompensationUpdateFormData,
} from "@/lib/compensationUpdateTemplate";
import { getOrCreateDmThread, sendMessage } from "@/lib/supabase/messaging";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { getAppUrl } from "@/lib/appUrl";
import { downloadSignableDocumentPdf } from "@/lib/downloadSignableDocumentPdf";
import { ROLE_LABELS, normalizeRole } from "@/lib/roleLabels";
import { useSignaturePad } from "@/hooks/useSignaturePad";
import { SignaturePadControls } from "@/components/SignaturePad";

const todayStr = () => new Date().toISOString().slice(0, 10);
const signLinkFor = (id: string) => `${getAppUrl()}/sign-compensation-update/${id}`;

const emptyForm = () => ({
  employeeId: "",
  newPosition: "",
  startingSalary: "",
  effectiveDate: todayStr(),
  salaryIncrease: "",
  seniorId: "",
  execId: "",
  skipSenior: false,
});

function statusLabel(doc: SignableDocument): string {
  if (doc.status === "confirmed") return "Completed";
  if (doc.status === "cancelled") return "Cancelled";
  const slot = doc.recipientSlot as CompensationSignatureSlot;
  const who = (doc.formData as CompensationUpdateFormData).signers?.[slot]?.name;
  if (slot === "hr_staff" && !who && doc.status === "pending_signature") return "Awaiting HR signature";
  if (doc.status === "signed") return `${COMPENSATION_SLOT_LABEL[slot] ?? slot} signed — waiting to move on`;
  return `Awaiting ${COMPENSATION_SLOT_LABEL[slot] ?? slot}${who ? ` — ${who}` : ""}`;
}

function statusClass(doc: SignableDocument): string {
  if (doc.status === "confirmed") return "bg-green-500/20 text-green-300 border-green-500/30";
  if (doc.status === "cancelled") return "bg-slate-500/20 text-slate-300 border-slate-500/30";
  if (doc.status === "signed") return "bg-orange-500/20 text-orange-300 border-orange-500/30";
  return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
}

/** The paper as the signing HR will see it — their name in the HR row (preview only; handleHrSign saves the real one). */
function withHrSignerName(data: CompensationUpdateFormData, hrName: string): CompensationUpdateFormData {
  if (!hrName) return data;
  return {
    ...data,
    signers: { ...data.signers, hr_staff: { ...data.signers.hr_staff, name: hrName } },
    recipientNames: { ...(data.recipientNames ?? {}), hr_staff: hrName },
  };
}

export function CompensationUpdateTab() {
  const { uid, displayName, companyId } = useAuth();
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [docs, setDocs] = useState<SignableDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [logoDataUrl, setLogoDataUrl] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewDoc, setViewDoc] = useState<SignableDocument | null>(null);
  const [hrSignDoc, setHrSignDoc] = useState<SignableDocument | null>(null);
  const [hrSigning, setHrSigning] = useState(false);
  const [hrSignError, setHrSignError] = useState<string | null>(null);
  const sigPad = useSignaturePad({ width: 500, height: 150 });

  const loadDocs = async () => setDocs(await getSignableDocuments("compensation_update"));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rows, logo] = await Promise.all([getCompanyUsers(), loadAssetDataUrl(() => import("@/assets/us-in-home-services-logo.png"))]);
        if (cancelled) return;
        setProfiles(rows);
        setLogoDataUrl(logo);
        await loadDocs();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const activeProfiles = useMemo(
    () => profiles.filter((p) => p.is_active).sort((a, b) => (a.display_name || "").localeCompare(b.display_name || "")),
    [profiles]
  );
  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const nameOf = (id: string) => profileById.get(id)?.display_name || profileById.get(id)?.email || "";

  const buildFormData = (): CompensationUpdateFormData => {
    const employeeName = nameOf(form.employeeId);
    return {
      employeeId: form.employeeId,
      employeeName,
      newPosition: form.newPosition.trim(),
      startingSalary: form.startingSalary.trim(),
      effectiveDate: form.effectiveDate,
      salaryIncrease: form.salaryIncrease.trim(),
      signers: {
        employee: { id: form.employeeId, name: employeeName },
        senior_manager: form.skipSenior ? { id: "", name: "" } : { id: form.seniorId, name: nameOf(form.seniorId) },
        executive: { id: form.execId, name: nameOf(form.execId) },
        // Signed by whichever HR user picks it up from the Sent list.
        hr_staff: { id: "", name: "" },
      },
      ...(form.skipSenior ? { skippedSlots: ["senior_manager" as const] } : {}),
      // First signer: the Senior, or the Executive when no Senior is needed.
      recipientSlot: form.skipSenior ? "executive" : "senior_manager",
      recipientName: nameOf(form.skipSenior ? form.execId : form.seniorId),
      recipientNames: form.skipSenior ? { executive: nameOf(form.execId) } : { senior_manager: nameOf(form.seniorId) },
    };
  };

  const missing = [
    !form.employeeId && "Employee",
    !form.newPosition.trim() && "New position",
    !form.startingSalary.trim() && "Starting Salary",
    !form.effectiveDate && "Effective next payroll",
    !form.salaryIncrease.trim() && "Salary Increase",
    !form.skipSenior && !form.seniorId && "Senior signer",
    !form.execId && "Executive signer",
  ].filter(Boolean) as string[];

  const handleSend = async () => {
    if (missing.length > 0 || !uid) return;
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const formData = buildFormData();
      const pdfBlob = await captureHtmlToPdfBlob(buildCompensationUpdateBodyMarkup(formData, logoDataUrl, {}), compensationUpdateStyles);
      const pdfUrl = await uploadCompensationUpdate(companyId ?? "", formData.employeeName, pdfBlob);
      const doc = await createSignableDocument({
        documentType: "compensation_update",
        formData: formData as unknown as Record<string, any>,
        recipientId: formData.recipientSlot === "executive" ? form.execId : form.seniorId,
        recipientSlot: formData.recipientSlot,
        pdfUrl,
      });
      const myProfileId = await getMyProfileId(uid);
      if (!myProfileId) throw new Error("Could not resolve your profile.");
      const firstId = formData.recipientSlot === "executive" ? form.execId : form.seniorId;
      const thread = await getOrCreateDmThread(myProfileId, firstId);
      await sendMessage({
        dmThreadId: thread.id,
        senderId: myProfileId,
        senderName: displayName || "HR",
        body: compensationSignRequestMessage(formData.recipientSlot, formData.employeeName, signLinkFor(doc.id)),
      });
      void logActivity({ action: "compensation_update_sent", targetType: "employee", targetId: form.employeeId, targetLabel: formData.employeeName });
      setNotice(
        form.skipSenior
          ? `Sent to ${formData.signers.executive.name} (Executive) — no Senior needed. Then HR signs it here, and finally ${formData.employeeName} signs last.`
          : `Sent to ${formData.signers.senior_manager.name} (Senior). Then it goes to ${formData.signers.executive.name} (Executive), then HR signs it here, and finally ${formData.employeeName} signs last.`
      );
      setForm(emptyForm());
      await loadDocs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send.");
    } finally {
      setSending(false);
    }
  };

  /** Fallback when an automatic hand-off didn't go through: HR moves it on (HR can reassign; a signer can't). */
  const handleSendOn = async (doc: SignableDocument) => {
    if (!uid) return;
    const data = doc.formData as CompensationUpdateFormData;
    const next = nextCompensationSlot(doc.recipientSlot as CompensationSignatureSlot, data);
    setBusyId(doc.id);
    setError(null);
    try {
      if (!next) {
        await confirmSignableDocument(doc.id, null);
      } else {
        const signer = data.signers?.[next];
        if (next === "hr_staff" && !signer?.id) {
          // HR queue — no single recipient; HR signs from the Sent list.
          await reassignSignableDocument(doc.id, { recipientName: "HR" }, next);
          await loadDocs();
          return;
        }
        if (!signer?.id) throw new Error(`No ${COMPENSATION_SLOT_LABEL[next]} signer was chosen for this document.`);
        await reassignSignableDocument(doc.id, { recipientId: signer.id, recipientName: signer.name }, next);
        const myProfileId = await getMyProfileId(uid);
        if (myProfileId) {
          const thread = await getOrCreateDmThread(myProfileId, signer.id);
          await sendMessage({
            dmThreadId: thread.id,
            senderId: myProfileId,
            senderName: displayName || "HR",
            body: compensationSignRequestMessage(next, data.employeeName, signLinkFor(doc.id)),
          });
        }
      }
      await loadDocs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send to the next signer.");
    } finally {
      setBusyId(null);
    }
  };

  /** HR's signature, from the Sent list — then it goes to the employee, who signs last. */
  const handleHrSign = async () => {
    const doc = hrSignDoc;
    if (!doc || !uid) return;
    const dataUrl = sigPad.hasContent() ? sigPad.toDataURL() : "";
    if (!dataUrl) {
      setHrSignError("Please add your signature first.");
      return;
    }
    setHrSigning(true);
    setHrSignError(null);
    try {
      const myProfileId = await getMyProfileId(uid);
      if (!myProfileId) throw new Error("Could not resolve your profile.");
      const myName = displayName || nameOf(myProfileId) || "HR";
      await refreshStorageAuthToken();
      const signatureUrl = await uploadSignableDocumentSignature(doc.companyId, doc.id, "hr_staff", dataUrl);
      const entry = { name: myName, url: signatureUrl, signedAt: new Date().toISOString() };
      const data = doc.formData as CompensationUpdateFormData;
      const formData: CompensationUpdateFormData = {
        ...data,
        signers: { ...data.signers, hr_staff: { id: myProfileId, name: myName } },
        recipientNames: { ...(data.recipientNames ?? {}), hr_staff: myName },
      };
      const signatures = { ...doc.signatures, hr_staff: entry };
      const captureSignatures = await resolveSignaturesForCapture(signatures, "hr_staff", dataUrl);
      const pdfBlob = await captureHtmlToPdfBlob(buildCompensationUpdateBodyMarkup(formData, logoDataUrl, captureSignatures), compensationUpdateStyles);
      const pdfUrl = await uploadCompensationUpdate(doc.companyId, formData.employeeName, pdfBlob);
      await signDocument(doc.id, "hr_staff", entry, pdfUrl, formData as unknown as Record<string, any>);

      // On to the employee, who signs last.
      const employee = formData.signers.employee;
      await reassignSignableDocument(doc.id, { recipientId: employee.id, recipientName: employee.name }, "employee");
      const thread = await getOrCreateDmThread(myProfileId, employee.id);
      await sendMessage({
        dmThreadId: thread.id,
        senderId: myProfileId,
        senderName: myName,
        body: compensationSignRequestMessage("employee", formData.employeeName, signLinkFor(doc.id)),
      });
      void logActivity({ action: "compensation_update_signed", targetType: "employee", targetId: formData.employeeId, targetLabel: formData.employeeName, details: { slot: "hr_staff", next: "employee" } });
      setNotice(`Signed as HR. Sent to ${formData.employeeName} to sign last.`);
      setHrSignDoc(null);
      sigPad.clear();
      await loadDocs();
    } catch (err) {
      setHrSignError(err instanceof Error ? err.message : "Failed to sign.");
    } finally {
      setHrSigning(false);
    }
  };

  const handleCancel = async (doc: SignableDocument) => {
    if (!window.confirm("Cancel this Promotion Paper and Wage Increase? It will be voided.")) return;
    setBusyId(doc.id);
    try {
      await cancelSignableDocument(doc.id);
      await loadDocs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (doc: SignableDocument) => {
    if (!window.confirm("Permanently delete this Promotion Paper and Wage Increase? This can't be undone.")) return;
    setBusyId(doc.id);
    try {
      await deleteSignableDocument(doc.id);
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete.");
    } finally {
      setBusyId(null);
    }
  };

  const personSelect = (label: string, value: string, onChange: (v: string) => void, hint?: string) => (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-slate-300">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="glass-input text-sm py-1.5 px-2.5 rounded-md">
        <option value="">Select…</option>
        {activeProfiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.display_name || p.email} — {ROLE_LABELS[normalizeRole(p.role)] ?? p.role}
          </option>
        ))}
      </select>
      {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
    </div>
  );

  const previewData = buildFormData();

  return (
    <div className="space-y-6">
      <div className="panel p-5">
        <h2 className="text-lg font-bold text-white mb-1">Promotion Paper and Wage Increase</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Fill in the details and choose the Senior and Executive. It's signed in order — Senior → Executive → HR → Employee — and moves to the next person automatically after each signature. The employee signs last.
        </p>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="space-y-4">
            {personSelect("Employee (recipient — signs last)", form.employeeId, (v) => setForm((f) => ({ ...f, employeeId: v })))}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-300">New position</label>
              <input value={form.newPosition} onChange={(e) => setForm((f) => ({ ...f, newPosition: e.target.value }))} placeholder="e.g. Senior Branch Manager" className="glass-input text-sm py-1.5 px-2.5 rounded-md" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-300">Starting Salary</label>
                <input value={form.startingSalary} onChange={(e) => setForm((f) => ({ ...f, startingSalary: e.target.value }))} placeholder="e.g. $52,000 / year" className="glass-input text-sm py-1.5 px-2.5 rounded-md" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-300">Effective next payroll</label>
                <input type="date" value={form.effectiveDate} onChange={(e) => setForm((f) => ({ ...f, effectiveDate: e.target.value }))} className="glass-input text-sm py-1.5 px-2.5 rounded-md [color-scheme:dark]" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-300">Salary Increase</label>
                <input value={form.salaryIncrease} onChange={(e) => setForm((f) => ({ ...f, salaryIncrease: e.target.value }))} placeholder="e.g. $4,000 (8%)" className="glass-input text-sm py-1.5 px-2.5 rounded-md" />
              </div>
            </div>
            <div className="rounded-lg border border-white/10 p-3 space-y-3">
              <p className="text-xs font-semibold text-slate-300">Signing order</p>
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer w-fit">
                <input type="checkbox" checked={form.skipSenior} onChange={(e) => setForm((f) => ({ ...f, skipSenior: e.target.checked, seniorId: e.target.checked ? "" : f.seniorId }))} />
                No Senior needed — start with the Executive
              </label>
              {form.skipSenior ? (
                <p className="text-xs text-slate-500 line-through">1. Senior</p>
              ) : (
                personSelect("1. Senior", form.seniorId, (v) => setForm((f) => ({ ...f, seniorId: v })))
              )}
              {personSelect("2. Executive", form.execId, (v) => setForm((f) => ({ ...f, execId: v })))}
              <p className="text-xs text-slate-400">3. HR — signs from the Sent list below (any HR) once the Executive has signed.</p>
              <p className="text-xs text-slate-400">4. Employee — {form.employeeId ? nameOf(form.employeeId) : "the recipient above"} signs last, which completes it.</p>
            </div>
            {error && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{error}</p>}
            {notice && <p className="text-xs text-green-300 bg-green-500/10 border border-green-500/30 rounded-md px-2.5 py-2">{notice}</p>}
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || missing.length > 0}
              title={missing.length > 0 ? `Still needed: ${missing.join(", ")}` : undefined}
              className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 inline-flex items-center gap-2"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sending ? "Sending…" : "Send for Signature"}
            </button>
            {missing.length > 0 && <p className="text-[11px] text-muted-foreground">Still needed: {missing.join(", ")}</p>}
          </div>

          <div className="rounded-lg bg-white/5 p-3 overflow-hidden">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Preview</p>
            <div className="flex justify-center overflow-hidden" style={{ height: 1056 * 0.62 }}>
              <div style={{ transform: "scale(0.62)", transformOrigin: "top center" }}>
                <style dangerouslySetInnerHTML={{ __html: compensationUpdateStyles }} />
                <div dangerouslySetInnerHTML={{ __html: buildCompensationUpdateBodyMarkup(previewData, logoDataUrl, {}) }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="panel p-0 overflow-x-auto">
        <div className="px-5 py-3 border-b border-white/10 font-semibold text-sm">Sent</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs uppercase text-slate-400">
              <th className="px-4 py-2">Employee</th>
              <th className="px-4 py-2">Issued By</th>
              <th className="px-4 py-2">Signers</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Sent</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400"><Loader2 className="h-4 w-4 animate-spin inline" /></td></tr>
            ) : docs.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Nothing sent yet.</td></tr>
            ) : docs.map((doc) => {
              const data = doc.formData as CompensationUpdateFormData;
              const busy = busyId === doc.id;
              const open = doc.status === "pending_signature" || doc.status === "signed";
              return (
                <tr key={doc.id} className="border-b border-white/5 hover:bg-white/5 align-top">
                  <td className="px-4 py-3 font-medium text-white">{data.employeeName || "—"}</td>
                  <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{doc.createdByName ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-slate-300">
                    {compensationSigningOrder(data).map((slot) => {
                      const signed = doc.signatures?.[slot];
                      const current = doc.status === "pending_signature" && doc.recipientSlot === slot;
                      return (
                        <div key={slot} className="whitespace-nowrap" title={signed ? `Signed ${new Date(signed.signedAt).toLocaleDateString()}` : current ? "Waiting on this signature" : "Not signed yet"}>
                          <span className={signed ? "text-green-400" : current ? "text-amber-300" : "text-slate-500"}>{signed ? "✓" : current ? "●" : "○"}</span>{" "}
                          {COMPENSATION_SLOT_LABEL[slot]}: {signed?.name || data.signers?.[slot]?.name || (slot === "hr_staff" ? "Any HR" : "—")}
                        </div>
                      );
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${statusClass(doc)}`}>{statusLabel(doc)}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{new Date(doc.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button type="button" onClick={() => setViewDoc(doc)} className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-semibold inline-flex items-center gap-1">
                        <Eye className="h-3 w-3" /> View
                      </button>
                      {doc.pdfUrl && (
                        <button type="button" onClick={() => downloadSignableDocumentPdf(doc.pdfUrl!, `Promotion Paper and Wage Increase - ${data.employeeName}.pdf`)} className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold inline-flex items-center gap-1">
                          <Download className="h-3 w-3" /> PDF
                        </button>
                      )}
                      {open && (
                        <button type="button" onClick={() => navigator.clipboard.writeText(signLinkFor(doc.id)).catch(() => {})} title="Copy the current signer's link" className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs font-semibold inline-flex items-center gap-1">
                          <Copy className="h-3 w-3" /> Link
                        </button>
                      )}
                      {doc.status === "pending_signature" && doc.recipientSlot === "hr_staff" && (
                        <button type="button" onClick={() => { setHrSignError(null); setHrSignDoc(doc); }} disabled={busy} className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded text-xs font-semibold inline-flex items-center gap-1">
                          <PenLine className="h-3 w-3" /> Sign as HR
                        </button>
                      )}
                      {doc.status === "signed" && (
                        <button type="button" onClick={() => handleSendOn(doc)} disabled={busy} className="px-2 py-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded text-xs font-semibold">
                          {nextCompensationSlot(doc.recipientSlot as CompensationSignatureSlot, data) ? "Send to next signer" : "Finalize"}
                        </button>
                      )}
                      {open && (
                        <button type="button" onClick={() => handleCancel(doc)} disabled={busy} className="px-2 py-1 bg-red-600/80 hover:bg-red-600 disabled:opacity-50 text-white rounded text-xs font-semibold inline-flex items-center gap-1">
                          <XCircle className="h-3 w-3" /> Cancel
                        </button>
                      )}
                      <button type="button" onClick={() => handleDelete(doc)} disabled={busy} title="Delete" className="p-1 text-red-400 hover:text-red-300 disabled:opacity-50">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hrSignDoc && (
        <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-3" onClick={() => !hrSigning && setHrSignDoc(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-lg w-full max-w-[900px] max-h-[94vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 shrink-0">
              <span className="text-sm font-semibold text-white">Sign as HR — {(hrSignDoc.formData as CompensationUpdateFormData).employeeName}</span>
              <button type="button" onClick={() => setHrSignDoc(null)} disabled={hrSigning} aria-label="Close" className="w-7 h-7 rounded bg-white/10 hover:bg-rose-600/40 text-white text-sm">✕</button>
            </div>
            <div className="overflow-auto">
              <div className="bg-white/5 p-4 flex justify-center overflow-hidden" style={{ height: 1056 * 0.7 }}>
                <div style={{ transform: "scale(0.7)", transformOrigin: "top center" }}>
                  <style dangerouslySetInnerHTML={{ __html: compensationUpdateStyles }} />
                  {/* The HR slot is "Any HR" until someone signs, so the paper
                      has no HR name yet — show the HR who's signing now. */}
                  <div dangerouslySetInnerHTML={{ __html: buildCompensationUpdateBodyMarkup(withHrSignerName(hrSignDoc.formData as CompensationUpdateFormData, displayName || ""), logoDataUrl, hrSignDoc.signatures) }} />
                </div>
              </div>
              <div className="p-4 border-t border-white/10">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">HR Signature</label>
                <canvas {...sigPad.canvasProps} className={`bg-white rounded-md border border-white/15 block mx-auto w-full max-w-md ${sigPad.canvasProps.className}`} />
                <div className="mt-2">
                  <SignaturePadControls pad={sigPad} />
                </div>
                {hrSignError && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2 mt-3">{hrSignError}</p>}
                <button type="button" onClick={handleHrSign} disabled={hrSigning} className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white mt-3 disabled:opacity-50 inline-flex items-center gap-2">
                  {hrSigning && <Loader2 className="h-4 w-4 animate-spin" />}
                  {hrSigning ? "Signing…" : "Confirm & Sign — send to employee"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {viewDoc && (
        <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-3" onClick={() => setViewDoc(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-lg w-full max-w-[900px] max-h-[94vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 shrink-0">
              <span className="text-sm font-semibold text-white">Promotion Paper and Wage Increase — {(viewDoc.formData as CompensationUpdateFormData).employeeName}</span>
              <button type="button" onClick={() => setViewDoc(null)} aria-label="Close" className="w-7 h-7 rounded bg-white/10 hover:bg-rose-600/40 text-white text-sm">✕</button>
            </div>
            <div className="overflow-auto bg-white/5 p-4 flex justify-center">
              <div style={{ transform: "scale(0.9)", transformOrigin: "top center" }}>
                <style dangerouslySetInnerHTML={{ __html: compensationUpdateStyles }} />
                <div dangerouslySetInnerHTML={{ __html: buildCompensationUpdateBodyMarkup(viewDoc.formData as CompensationUpdateFormData, logoDataUrl, viewDoc.signatures) }} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
