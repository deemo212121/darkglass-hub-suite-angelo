/**
 * External Fill Contractor Data — the no-login counterpart to
 * FillContractorDataPage.tsx, opened from the link ReportHRDaily.tsx's
 * "Send Request" panel generates when HR picks "External Link" instead of
 * an AHS teammate. No AHS account needed: talks only to
 * /api/signable-documents (see externalSignableDocuments.ts /
 * signableDocumentsBridge.ts), which only ever serves/accepts documents
 * that have no linked AHS profile (recipient_id IS NULL).
 *
 * Same plain-HTML-form + live-preview layout as FillContractorDataPage.tsx
 * (there's no source PDF here — see contractorDataFormTemplate.ts's header
 * comment). The PDF is built entirely client-side via the same pure
 * buildContractorDataBodyMarkup/captureHtmlToPdfBlob used by the logged-in
 * flow, then POSTed already-finished to the server bridge along with the
 * two ID-photo files as `attachment_*` entries (see
 * submitExternalSignature's header comment) — the bridge uploads them and
 * notifies HR, no DM step here since there's no sender profile.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import logo from "@/assets/Admin Hub Solutions Logo no Text.png";
import { getExternalSignableDocument, submitExternalSignature, type ExternalSignableDocument } from "@/lib/supabase/externalSignableDocuments";
import { captureHtmlToPdfBlob, loadAssetDataUrl } from "@/lib/pdfCapture";
import {
  buildContractorDataBodyMarkup,
  contractorDataStyles,
  CONTRACTOR_DATA_BRANCHES,
  CONTRACTOR_DATA_STATES,
  CONTRACTOR_DATA_COUNTRIES,
  CONTRACTOR_DATA_MARITAL_STATUSES,
  BLANK_EMERGENCY_CONTACT,
  type ContractorDataFormData,
  type ContractorDataEmergencyContact,
} from "@/lib/contractorDataFormTemplate";

interface Props {
  docId: string;
}

const BLANK_FORM: ContractorDataFormData = {
  employeeId: "",
  employeeName: "",
  firstName: "",
  middleName: "",
  lastName: "",
  branch: "",
  streetAddress: "",
  city: "",
  state: "",
  zipCode: "",
  country: "",
  phoneNumber: "",
  otherPhoneNumber: "",
  startDate: "",
  birthDate: "",
  ssn: "",
  ssnCardUrls: [],
  driversLicenseNumber: "",
  driversLicenseState: "",
  driversLicenseUrls: [],
  email: "",
  maritalStatus: "",
  spouseName: "",
  spouseEmployer: "",
  livedInNewYork: "",
  emergencyContacts: [{ ...BLANK_EMERGENCY_CONTACT }, { ...BLANK_EMERGENCY_CONTACT }, { ...BLANK_EMERGENCY_CONTACT }],
  dateSigned: "",
  signatureDataUrl: "",
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December",
];

function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

const inputCls = "glass-input text-sm py-1.5 px-3 rounded-md w-full";
const labelCls = "text-[10px] font-semibold text-muted-foreground uppercase tracking-wide";

export function ExternalFillContractorDataPage({ docId }: Props) {
  const [doc, setDoc] = useState<ExternalSignableDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedPdfUrl, setSubmittedPdfUrl] = useState<string | null>(null);
  const [logoDataUrl, setLogoDataUrl] = useState("");

  const [form, setForm] = useState<ContractorDataFormData>({ ...BLANK_FORM });
  const [birthMonth, setBirthMonth] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [ssnCardFiles, setSsnCardFiles] = useState<File[]>([]);
  const [driversLicenseFiles, setDriversLicenseFiles] = useState<File[]>([]);

  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasDrawnRef = useRef(false);

  useEffect(() => {
    loadAssetDataUrl(() => import("@/assets/us-in-home-services-logo.png")).then(setLogoDataUrl);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const document = await getExternalSignableDocument(docId);
        if (cancelled) return;
        if (!document || document.documentType !== "contractor_data") {
          setError("This link isn't valid, or the document doesn't use link-based signing.");
        } else {
          setDoc(document);
          const existing = document.formData as Partial<ContractorDataFormData>;
          setForm((prev) => ({ ...prev, ...existing, employeeName: existing.employeeName || document.recipientName || "" }));
          if (existing.birthDate) {
            const [y, m, d] = existing.birthDate.split("-");
            setBirthYear(y ?? "");
            setBirthMonth(m ? String(Number(m)) : "");
            setBirthDay(d ? String(Number(d)) : "");
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load document.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [docId]);

  useEffect(() => {
    if (birthMonth && birthDay && birthYear) {
      updateField("birthDate", `${birthYear}-${birthMonth.padStart(2, "0")}-${birthDay.padStart(2, "0")}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [birthMonth, birthDay, birthYear]);

  const updateField = <K extends keyof ContractorDataFormData>(key: K, value: ContractorDataFormData[K]) => setForm((f) => ({ ...f, [key]: value }));

  const updateEmergencyContact = <K extends keyof ContractorDataEmergencyContact>(index: number, key: K, value: ContractorDataEmergencyContact[K]) =>
    setForm((f) => ({ ...f, emergencyContacts: f.emergencyContacts.map((c, i) => (i === index ? { ...c, [key]: value } : c)) }));

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = sigCanvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };
  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = true;
    const ctx = sigCanvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = sigCanvasRef.current!.getContext("2d")!;
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
    const c = sigCanvasRef.current;
    if (!c) return;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    hasDrawnRef.current = false;
  };

  const validate = (): string | null => {
    if (!form.firstName.trim()) return "Enter your first name.";
    if (!form.middleName.trim()) return "Enter your middle name (or N/A).";
    if (!form.lastName.trim()) return "Enter your last name.";
    if (!form.branch) return "Select your branch.";
    if (!form.streetAddress.trim() || !form.city.trim() || !form.state || !form.zipCode.trim() || !form.country) return "Fill in your complete current address.";
    if (!form.phoneNumber.trim()) return "Enter your phone number.";
    if (!form.otherPhoneNumber.trim()) return "Enter another telephone number.";
    if (!form.startDate) return "Enter your start date.";
    if (!birthMonth || !birthDay || !birthYear) return "Select your complete birth date.";
    if (!form.ssn.trim()) return "Enter your Social Security Number.";
    if (ssnCardFiles.length === 0) return "Upload a photo of your Social Security Card (or National/Government ID).";
    if (!form.driversLicenseNumber.trim()) return "Enter your Driver's License number.";
    if (!form.driversLicenseState) return "Select the state your Driver's License was issued in.";
    if (driversLicenseFiles.length === 0) return "Upload a photo of your Driver's License (or another government ID).";
    if (!form.email.trim()) return "Enter your email address.";
    if (!form.maritalStatus) return "Select your marital status.";
    if (!form.spouseName.trim()) return "Enter your spouse's name (or N/A).";
    if (!form.spouseEmployer.trim()) return "Enter your spouse's employer (or N/A).";
    if (!form.livedInNewYork) return "Answer whether you've lived in New York in the last 7 years.";
    const contact1 = form.emergencyContacts[0];
    if (!contact1.firstName.trim()) return "Enter Emergency Contact 1's first name.";
    if (!contact1.middleName.trim()) return "Enter Emergency Contact 1's middle name (or N/A).";
    if (!contact1.lastName.trim()) return "Enter Emergency Contact 1's last name.";
    if (!contact1.relationship.trim()) return "Enter Emergency Contact 1's relationship.";
    if (!contact1.contactNumber.trim()) return "Enter Emergency Contact 1's phone number.";
    if (!hasDrawnRef.current) return "Please draw your signature.";
    return null;
  };

  const handleSubmit = async () => {
    if (!doc || !sigCanvasRef.current) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const employeeName = [form.firstName, form.middleName, form.lastName].filter(Boolean).join(" ");
      const dataUrl = sigCanvasRef.current.toDataURL("image/png");
      const signatureBlob = await (await fetch(dataUrl)).blob();
      const signedAt = new Date().toISOString();
      // Placeholder URLs — the server bridge fills these in for real once it
      // uploads the attachment_* files below, see submitExternalSignature's
      // header comment.
      const finalData: ContractorDataFormData = { ...form, employeeName, dateSigned: signedAt, signatureDataUrl: dataUrl };

      const pdfBlob = await captureHtmlToPdfBlob(
        buildContractorDataBodyMarkup(
          { ...finalData, ssnCardUrls: ssnCardFiles.map((f) => URL.createObjectURL(f)), driversLicenseUrls: driversLicenseFiles.map((f) => URL.createObjectURL(f)) },
          logoDataUrl,
          { name: employeeName, url: dataUrl, signedAt }
        ),
        contractorDataStyles
      );

      const { pdfUrl } = await submitExternalSignature(docId, {
        signatureBlob,
        pdfBlob,
        formData: finalData as unknown as Record<string, any>,
        attachments: { ssnCardUrls: ssnCardFiles, driversLicenseUrls: driversLicenseFiles },
      });

      setSubmittedPdfUrl(pdfUrl);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit form.");
    } finally {
      setSubmitting(false);
    }
  };

  const previewData: ContractorDataFormData = useMemo(
    () => ({
      ...form,
      employeeName: [form.firstName, form.middleName, form.lastName].filter(Boolean).join(" "),
      ssnCardUrls: ssnCardFiles.map((f) => URL.createObjectURL(f)),
      driversLicenseUrls: driversLicenseFiles.map((f) => URL.createObjectURL(f)),
    }),
    [form, ssnCardFiles, driversLicenseFiles]
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-4">
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
            {submittedPdfUrl && (
              <a href={submittedPdfUrl} target="_blank" rel="noreferrer noopener" className="text-blue-300 hover:text-blue-200 underline text-sm">
                View the completed PDF
              </a>
            )}
            {!submittedPdfUrl && <p className="text-xs text-muted-foreground">You can close this page now.</p>}
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="panel p-4 flex-1 min-w-0">
              <p className="text-xs text-muted-foreground mb-4">Please make sure to fill out the form correctly. Thank you!</p>

              <div className="flex flex-col gap-4">
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Personal Information</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div><label className={labelCls}>First Name*</label><input className={inputCls} value={form.firstName} onChange={(e) => updateField("firstName", e.target.value)} /></div>
                    <div><label className={labelCls}>Middle Name* <span className="normal-case font-normal">(N/A if none)</span></label><input className={inputCls} value={form.middleName} onChange={(e) => updateField("middleName", e.target.value)} /></div>
                    <div><label className={labelCls}>Last Name*</label><input className={inputCls} value={form.lastName} onChange={(e) => updateField("lastName", e.target.value)} /></div>
                    <div>
                      <label className={labelCls}>Branch*</label>
                      <select className={inputCls} value={form.branch} onChange={(e) => updateField("branch", e.target.value)}>
                        <option value="">Please Select</option>
                        {CONTRACTOR_DATA_BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                    <div><label className={labelCls}>Email Address*</label><input type="email" className={inputCls} placeholder="ex: myname@example.com" value={form.email} onChange={(e) => updateField("email", e.target.value)} /></div>
                    <div><label className={labelCls}>Start Date*</label><input type="date" className={inputCls} value={form.startDate} onChange={(e) => updateField("startDate", e.target.value)} /></div>
                    <div><label className={labelCls}>Phone Number*</label><input className={inputCls} placeholder="(000) 000-0000" value={form.phoneNumber} onChange={(e) => updateField("phoneNumber", formatPhoneInput(e.target.value))} /></div>
                    <div><label className={labelCls}>Other Telephone*</label><input className={inputCls} placeholder="(000) 000-0000" value={form.otherPhoneNumber} onChange={(e) => updateField("otherPhoneNumber", formatPhoneInput(e.target.value))} /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 mt-3">
                    <div>
                      <label className={labelCls}>Birth Month*</label>
                      <select className={inputCls} value={birthMonth} onChange={(e) => setBirthMonth(e.target.value)}>
                        <option value="">Month</option>
                        {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Birth Day*</label>
                      <select className={inputCls} value={birthDay} onChange={(e) => setBirthDay(e.target.value)}>
                        <option value="">Day</option>
                        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={String(d)}>{d}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Birth Year*</label>
                      <select className={inputCls} value={birthYear} onChange={(e) => setBirthYear(e.target.value)}>
                        <option value="">Year</option>
                        {Array.from({ length: 80 }, (_, i) => new Date().getFullYear() - 15 - i).map((y) => <option key={y} value={String(y)}>{y}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Current Address</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2"><label className={labelCls}>Street Address*</label><input className={inputCls} value={form.streetAddress} onChange={(e) => updateField("streetAddress", e.target.value)} /></div>
                    <div><label className={labelCls}>City*</label><input className={inputCls} value={form.city} onChange={(e) => updateField("city", e.target.value)} /></div>
                    <div>
                      <label className={labelCls}>State*</label>
                      <select className={inputCls} value={form.state} onChange={(e) => updateField("state", e.target.value)}>
                        <option value="">Please Select</option>
                        {CONTRACTOR_DATA_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div><label className={labelCls}>Zip Code*</label><input className={inputCls} value={form.zipCode} onChange={(e) => updateField("zipCode", e.target.value)} /></div>
                    <div>
                      <label className={labelCls}>Country*</label>
                      <select className={inputCls} value={form.country} onChange={(e) => updateField("country", e.target.value)}>
                        <option value="">Please Select</option>
                        {CONTRACTOR_DATA_COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Identification</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><label className={labelCls}>Social Security Number*</label><input className={inputCls} value={form.ssn} onChange={(e) => updateField("ssn", e.target.value)} /></div>
                    <div>
                      <label className={labelCls}>SSN Card — Front & Back*</label>
                      <input type="file" multiple accept="image/*" className={inputCls} onChange={(e) => setSsnCardFiles(Array.from(e.target.files ?? []))} />
                      <p className="text-[10px] text-muted-foreground mt-1">Disclaimer: For PH staff, please upload your National ID / Government ID instead.</p>
                    </div>
                    <div><label className={labelCls}>Driver's License Number*</label><input className={inputCls} value={form.driversLicenseNumber} onChange={(e) => updateField("driversLicenseNumber", e.target.value)} /></div>
                    <div>
                      <label className={labelCls}>State Issued*</label>
                      <select className={inputCls} value={form.driversLicenseState} onChange={(e) => updateField("driversLicenseState", e.target.value)}>
                        <option value="">Please Select</option>
                        {CONTRACTOR_DATA_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className={labelCls}>Driver's License — Front & Back*</label>
                      <input type="file" multiple accept="image/*" className={inputCls} onChange={(e) => setDriversLicenseFiles(Array.from(e.target.files ?? []))} />
                      <p className="text-[10px] text-muted-foreground mt-1">Disclaimer: If you don't have a driver's license, you can upload another government ID.</p>
                    </div>
                  </div>
                </div>

                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Marital Status & Residency</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Marital Status*</label>
                      <select className={inputCls} value={form.maritalStatus} onChange={(e) => updateField("maritalStatus", e.target.value)}>
                        <option value="">Please Select</option>
                        {CONTRACTOR_DATA_MARITAL_STATUSES.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Lived in New York in the last 7 years?*</label>
                      <select className={inputCls} value={form.livedInNewYork} onChange={(e) => updateField("livedInNewYork", e.target.value as ContractorDataFormData["livedInNewYork"])}>
                        <option value="">Please Select</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                    </div>
                    <div><label className={labelCls}>Spouse's Name* <span className="normal-case font-normal">(N/A if none)</span></label><input className={inputCls} value={form.spouseName} onChange={(e) => updateField("spouseName", e.target.value)} /></div>
                    <div><label className={labelCls}>Spouse's Employer* <span className="normal-case font-normal">(N/A if none)</span></label><input className={inputCls} value={form.spouseEmployer} onChange={(e) => updateField("spouseEmployer", e.target.value)} /></div>
                  </div>
                </div>

                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Emergency Contacts</h2>
                  <div className="flex flex-col gap-4">
                    {form.emergencyContacts.map((contact, i) => (
                      <div key={i} className="border border-white/10 rounded-md p-3">
                        <p className="text-[11px] font-semibold mb-2">{i + 1}. Full Name{i === 0 ? "*" : " (Optional)"}</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div><label className={labelCls}>First Name{i === 0 ? "*" : ""}</label><input className={inputCls} value={contact.firstName} onChange={(e) => updateEmergencyContact(i, "firstName", e.target.value)} /></div>
                          <div><label className={labelCls}>Middle Name{i === 0 ? "*" : ""} <span className="normal-case font-normal">(N/A if none)</span></label><input className={inputCls} value={contact.middleName} onChange={(e) => updateEmergencyContact(i, "middleName", e.target.value)} /></div>
                          <div><label className={labelCls}>Last Name{i === 0 ? "*" : ""}</label><input className={inputCls} value={contact.lastName} onChange={(e) => updateEmergencyContact(i, "lastName", e.target.value)} /></div>
                          <div><label className={labelCls}>Relationship{i === 0 ? "*" : ""}</label><input className={inputCls} value={contact.relationship} onChange={(e) => updateEmergencyContact(i, "relationship", e.target.value)} /></div>
                          <div><label className={labelCls}>Contact #{i === 0 ? "*" : ""}</label><input className={inputCls} placeholder="(000) 000-0000" value={contact.contactNumber} onChange={(e) => updateEmergencyContact(i, "contactNumber", formatPhoneInput(e.target.value))} /></div>
                          <div><label className={labelCls}>Secondary Contact #</label><input className={inputCls} placeholder="(000) 000-0000" value={contact.secondaryContactNumber} onChange={(e) => updateEmergencyContact(i, "secondaryContactNumber", formatPhoneInput(e.target.value))} /></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className={labelCls}>Draw your signature</label>
                  <canvas
                    ref={sigCanvasRef}
                    width={500}
                    height={130}
                    onPointerDown={startDraw}
                    onPointerMove={moveDraw}
                    onPointerUp={endDraw}
                    onPointerLeave={endDraw}
                    className="bg-white rounded-md border border-white/15 w-full max-w-md touch-none cursor-crosshair mt-1"
                  />
                  <button onClick={clearSignature} className="btn text-xs px-3 py-1.5 mt-2">Clear signature</button>
                </div>

                {error && (
                  <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{error}</p>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 w-fit"
                >
                  {submitting ? "Submitting…" : "Submit"}
                </button>
              </div>
            </div>

            <div className="lg:w-[420px] shrink-0">
              <div className="panel p-4 sticky top-4">
                <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Live Preview</h2>
                <div className="overflow-auto bg-white/5 rounded-md p-2" style={{ maxHeight: "80vh" }}>
                  <div style={{ transform: "scale(0.45)", transformOrigin: "top left", width: "816px" }}>
                    <style dangerouslySetInnerHTML={{ __html: contractorDataStyles }} />
                    <div dangerouslySetInnerHTML={{ __html: buildContractorDataBodyMarkup(previewData, logoDataUrl, undefined) }} />
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
