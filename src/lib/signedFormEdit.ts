/**
 * Form Inconsistencies → a signed form's Edit: HR corrects the fields the
 * check compares (name, SSN, date of birth, address, phone, email, driver's
 * license #) and the form's PDF is rebuilt from the corrected answers with
 * the person's own saved signature(s) — the same rebuild each form's
 * "Regenerate PDF" does in HR Paperworks — so the copy on file says what its
 * form data says. If they'd rather the person redo it, Send form again
 * (formConsistencyReviews.ts's sendFormsAgain) does that instead.
 *
 * Each edit is kept on the form (form_data.hrEdits: who, when, and what each
 * field was) and logged in Activity Logs (which fields — never the values).
 * Refused, nothing saved, when there's nothing to rebuild from: a scanned
 * paper copy, or no saved signature (the PDF would come out unsigned).
 */
import type { SignableDocument, SignableDocumentType } from "@/lib/supabase/signableDocuments";
import { updateSignableDocumentPdfUrl } from "@/lib/supabase/signableDocuments";
import { logActivity } from "@/lib/supabase/hrActivityLog";
import { documentOwner, type ConsistencyField } from "@/lib/formConsistency";

export interface EditableFormField {
  /** form_data key. */
  key: string;
  label: string;
  field: ConsistencyField;
}

/** One HR correction, kept on the form in form_data.hrEdits. */
export interface SignedFormEdit {
  at: string;
  byId: string | null;
  byName: string | null;
  changes: { key: string; label: string; from: string; to: string }[];
}

// ─── Which fields each form has ─────────────────────────────────────────────
// The form_data keys formConsistency.ts's EXTRACT reads, per form type.

const f = (key: string, label: string, field: ConsistencyField): EditableFormField => ({ key, label, field });
const NAME = [f("firstName", "First name", "name"), f("middleName", "Middle name", "name"), f("lastName", "Last name", "name")];
const ADDRESS = (street: string, city: string, state: string, zip: string) => [
  f(street, "Street address", "address"), f(city, "City", "address"), f(state, "State", "address"), f(zip, "ZIP", "address"),
];
const CONTRACTOR_DATA = [
  ...NAME, f("ssn", "SSN", "ssn"), f("birthDate", "Date of birth", "dob"), ...ADDRESS("streetAddress", "city", "state", "zipCode"),
  f("phoneNumber", "Phone", "phone"), f("email", "Email", "email"), f("driversLicenseNumber", "Driver's license #", "license"),
];
const W4_FIELDS = [
  f("firstNameMiddleInitial", "First name & middle initial", "name"), f("lastName", "Last name", "name"), f("ssn", "SSN", "ssn"),
  f("address", "Street address", "address"), f("cityStateZip", "City, state, ZIP", "address"),
];
const MASTER_W2 = [...NAME, ...ADDRESS("addressStreet", "addressCity", "addressState", "addressZip"), f("phone", "Phone", "phone"), f("email", "Email", "email")];

const FIELDS: Partial<Record<SignableDocumentType, EditableFormField[]>> = {
  i9: [
    f("firstName", "First name", "name"), f("middleInitial", "Middle initial", "name"), f("lastName", "Last name", "name"),
    f("ssn", "SSN", "ssn"), f("dateOfBirth", "Date of birth", "dob"), ...ADDRESS("address", "city", "state", "zip"),
    f("phone", "Phone", "phone"), f("email", "Email", "email"),
  ],
  w4: W4_FIELDS,
  w4r: W4_FIELDS,
  w9: [
    f("ssnPart1", "SSN — first 3", "ssn"), f("ssnPart2", "SSN — middle 2", "ssn"), f("ssnPart3", "SSN — last 4", "ssn"),
    f("address", "Street address", "address"), f("cityStateZip", "City, state, ZIP", "address"),
  ],
  ssn_card_form: [f("ssn", "SSN", "ssn")],
  contractor_data: CONTRACTOR_DATA,
  contractor_data_us: CONTRACTOR_DATA,
  direct_deposit: [...NAME, ...ADDRESS("streetAddress", "city", "state", "zipCode")],
  employee_confidentiality: ADDRESS("address", "city", "state", "zip"),
  nda_form: ADDRESS("address", "city", "state", "zip"),
  master_w2_agreement: MASTER_W2,
  master_w2_office_agreement: MASTER_W2,
  master_ph_contractor_agreement: [...NAME, f("dateOfBirth", "Date of birth", "dob"), f("phone", "Phone", "phone"), f("email", "Email", "email")],
  w8ben: [f("dateOfBirth", "Date of birth", "dob")],
  drivers_license_form: [f("licenseNumber", "Driver's license #", "license")],
  parts_responsibility: NAME,
  pto_ack: NAME,
  meal_rest_break: NAME,
  mileage_fuel: NAME,
  car_iq_agreement: NAME,
  vehicle_agreement: NAME,
  vehicle_use_agreement: NAME,
};

/**
 * How each form's fill page wrote form_data.employeeName from the name parts
 * when they signed — redone the same way when HR corrects a name part.
 */
const FULL_NAME: Partial<Record<SignableDocumentType, "first-last" | "first-middle-last">> = {
  i9: "first-last", car_iq_agreement: "first-last", vehicle_agreement: "first-last", vehicle_use_agreement: "first-last",
  contractor_data: "first-middle-last", contractor_data_us: "first-middle-last", direct_deposit: "first-middle-last",
  master_w2_agreement: "first-middle-last", master_w2_office_agreement: "first-middle-last", master_ph_contractor_agreement: "first-middle-last",
  parts_responsibility: "first-middle-last", pto_ack: "first-middle-last", meal_rest_break: "first-middle-last", mileage_fuel: "first-middle-last",
};

/** The fields HR can correct on this form (the ones it actually has), or [] when it can't be edited. */
export function editableFields(doc: Pick<SignableDocument, "documentType" | "formData">): EditableFormField[] {
  if (doc.formData?.paperCopy) return [];
  return (FIELDS[doc.documentType] ?? []).filter((x) => x.key in (doc.formData ?? {}));
}

/** Why this form can't be edited here, or null when it can. */
export function whyNotEditable(doc: Pick<SignableDocument, "documentType" | "formData" | "status">): string | null {
  if (doc.formData?.paperCopy) return "This is a scanned paper copy — there's nothing to rebuild it from. Send the form again instead.";
  if (doc.status !== "signed" && doc.status !== "confirmed") return "Only a signed form can be edited.";
  if (editableFields(doc).length === 0) return "This form has none of the fields this check compares.";
  return null;
}

export const editHistoryOf = (doc: Pick<SignableDocument, "formData">): SignedFormEdit[] =>
  Array.isArray(doc.formData?.hrEdits) ? (doc.formData.hrEdits as SignedFormEdit[]) : [];

// ─── Rebuilding the PDF ─────────────────────────────────────────────────────

const text = (v: unknown) => (v == null ? "" : String(v));
const nameOf = (d: Record<string, any>, fallback: string) =>
  text(d.employeeName).trim() || [d.firstName, d.lastName].filter(Boolean).join(" ").trim() || fallback;

async function bytesOf(dataUrl: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
}

/** The signer's saved signature as a data: URL — from form_data when the form keeps it there, else the stored one (through the image proxy). */
async function signatureDataUrl(doc: SignableDocument, inlineKey: string | null, slot = "employee"): Promise<string | null> {
  const inline = inlineKey ? text(doc.formData?.[inlineKey]) : "";
  if (inline.startsWith("data:")) return inline;
  const stored = doc.signatures?.[slot as keyof typeof doc.signatures];
  if (!stored?.url) return null;
  const { resolveSignaturesForCapture } = await import("@/lib/pdfCapture");
  const resolved = await resolveSignaturesForCapture({ [slot]: stored }, "__rebuild__", "");
  const url = resolved[slot]?.url ?? "";
  return url.startsWith("data:") ? url : null;
}

const NO_SIGNATURE = "Couldn't load their saved signature, so the PDF can't be rebuilt — nothing was changed. Send the form again instead.";

async function requiredSignatureBytes(doc: SignableDocument, inlineKey: string | null): Promise<Uint8Array> {
  const url = await signatureDataUrl(doc, inlineKey);
  if (!url) throw new Error(NO_SIGNATURE);
  return bytesOf(url);
}
async function optionalSignatureBytes(doc: SignableDocument, inlineKey: string): Promise<Uint8Array | undefined> {
  const inline = text(doc.formData?.[inlineKey]);
  return inline.startsWith("data:") ? bytesOf(inline) : undefined;
}

async function logos() {
  const { loadAssetDataUrl } = await import("@/lib/pdfCapture");
  const [ahs, usihs] = await Promise.all([
    loadAssetDataUrl(() => import("@/assets/admin-hub-solutions-logo-badge.png")),
    loadAssetDataUrl(() => import("@/assets/us-in-home-services-logo.png")),
  ]);
  return { ahs, usihs };
}

/** A form built from an HTML template with its signature in hr_signable_documents.signatures — same as regenerateSimpleSignableDocumentPdf. */
async function simpleTemplatePdf(doc: SignableDocument, logo: string, build: (data: any, logo: string, sig: any) => string, styles: string, photoKey?: string): Promise<Blob> {
  const pdf = await import("@/lib/pdfCapture");
  const resolved = await pdf.resolveSignaturesForCapture(doc.signatures ?? {}, "__rebuild__", "");
  const sig = resolved.employee;
  if (doc.signatures?.employee && !sig?.url?.startsWith("data:")) throw new Error(NO_SIGNATURE);
  let data = doc.formData;
  const photos = photoKey ? data?.[photoKey] : null;
  if (photoKey && Array.isArray(photos) && photos.length > 0) data = { ...data, [photoKey]: await pdf.resolvePhotoUrlsForCapture(photos as string[]) };
  return pdf.captureHtmlToPdfBlob(build(data, logo, sig), styles);
}

/** A two-party Master Agreement — both signatures are data: URLs in form_data. */
async function masterAgreementPdf(doc: SignableDocument, logo: string, build: (data: any, logo: string) => string, styles: string, signatureKey: string): Promise<Blob> {
  if (!text(doc.formData?.[signatureKey]).startsWith("data:")) throw new Error(NO_SIGNATURE);
  const { captureHtmlToPdfBlob } = await import("@/lib/pdfCapture");
  return captureHtmlToPdfBlob(build(doc.formData, logo), styles);
}

const asBlob = (bytes: Uint8Array) => new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });

/** This form's PDF built from `doc.formData`, and where it's uploaded to. */
async function buildPdf(doc: SignableDocument): Promise<{ blob: Blob; upload: (companyId: string, name: string, blob: Blob) => Promise<string>; name: string }> {
  const d = doc.formData ?? {};
  const s = await import("@/lib/firebase/storage");
  switch (doc.documentType) {
    case "i9": {
      const { fillI9Pdf } = await import("@/lib/i9PdfFill");
      return { blob: asBlob(await fillI9Pdf(d as any, await requiredSignatureBytes(doc, "employeeSignatureDataUrl"), await optionalSignatureBytes(doc, "employerSignatureDataUrl"))), upload: s.uploadI9Form, name: nameOf(d, "i9") };
    }
    case "w4": {
      const { fillW4Pdf } = await import("@/lib/w4PdfFill");
      return { blob: asBlob(await fillW4Pdf(d as any, await requiredSignatureBytes(doc, "signatureDataUrl"))), upload: s.uploadW4Form, name: `${text(d.firstNameMiddleInitial)} ${text(d.lastName)}`.trim() || "w4" };
    }
    case "w4r": {
      const { fillW4RPdf } = await import("@/lib/w4rPdfFill");
      return { blob: asBlob(await fillW4RPdf(d as any, await requiredSignatureBytes(doc, "signatureDataUrl"))), upload: s.uploadW4RForm, name: `${text(d.firstNameMiddleInitial)} ${text(d.lastName)}`.trim() || "w4r" };
    }
    case "w9": {
      const { fillW9Pdf } = await import("@/lib/w9PdfFill");
      return { blob: asBlob(await fillW9Pdf(d as any, await requiredSignatureBytes(doc, "signatureDataUrl"))), upload: s.uploadW9Form, name: text(d.name).trim() || "w9" };
    }
    case "w8ben": {
      const { fillW8benPdf } = await import("@/lib/w8benPdfFill");
      return { blob: asBlob(await fillW8benPdf(d as any, await requiredSignatureBytes(doc, null))), upload: s.uploadW8benForm, name: nameOf(d, "w8ben") };
    }
    case "employee_confidentiality": {
      const { fillEmployeeConfidentialityPdf } = await import("@/lib/employeeConfidentialityPdfFill");
      return { blob: asBlob(await fillEmployeeConfidentialityPdf(d as any, await requiredSignatureBytes(doc, "signatureDataUrl"))), upload: s.uploadEmployeeConfidentialityForm, name: nameOf(d, "employee-confidentiality") };
    }
    case "parts_responsibility": {
      const { fillPartsResponsibilityPdf } = await import("@/lib/partsResponsibilityPdfFill");
      return { blob: asBlob(await fillPartsResponsibilityPdf(d as any, await requiredSignatureBytes(doc, "technicianSignatureDataUrl"), await optionalSignatureBytes(doc, "managerSignatureDataUrl"))), upload: s.uploadPartsResponsibilityForm, name: nameOf(d, "parts-responsibility") };
    }
    case "pto_ack": {
      const { fillPtoAckPdf } = await import("@/lib/ptoAckPdfFill");
      return { blob: asBlob(await fillPtoAckPdf(d as any, await requiredSignatureBytes(doc, "signatureDataUrl"))), upload: s.uploadPtoAckForm, name: nameOf(d, "pto-ack") };
    }
    case "meal_rest_break": {
      const { fillMealRestBreakPdf } = await import("@/lib/mealRestBreakPdfFill");
      return { blob: asBlob(await fillMealRestBreakPdf(d as any, await requiredSignatureBytes(doc, "employeeSignatureDataUrl"), await optionalSignatureBytes(doc, "employerSignatureDataUrl"))), upload: s.uploadMealRestBreakForm, name: nameOf(d, "meal-rest-break") };
    }
    case "mileage_fuel": {
      const { fillMileageFuelPdf } = await import("@/lib/mileageFuelPdfFill");
      return { blob: asBlob(await fillMileageFuelPdf(d as any, await requiredSignatureBytes(doc, "employeeSignatureDataUrl"), await optionalSignatureBytes(doc, "employerSignatureDataUrl"))), upload: s.uploadMileageFuelForm, name: nameOf(d, "mileage-fuel") };
    }
    case "car_iq_agreement": {
      const { fillCarIqAgreementPdf } = await import("@/lib/carIqAgreementPdfFill");
      return { blob: asBlob(await fillCarIqAgreementPdf(d as any, await requiredSignatureBytes(doc, "signatureDataUrl"))), upload: s.uploadCarIqAgreementForm, name: nameOf(d, "car-iq-agreement") };
    }
    case "vehicle_agreement": {
      const { fillVehicleAgreementPdf } = await import("@/lib/vehicleAgreementPdfFill");
      return { blob: asBlob(await fillVehicleAgreementPdf(d as any, await requiredSignatureBytes(doc, "signatureDataUrl"))), upload: s.uploadVehicleAgreementForm, name: nameOf(d, "vehicle-agreement") };
    }
    case "master_w2_agreement": {
      const t = await import("@/lib/masterW2AgreementFormTemplate");
      const l = await logos();
      return { blob: await masterAgreementPdf(doc, l.usihs, t.buildMasterW2AgreementBodyMarkup, t.masterW2AgreementStyles, "employeeSignatureDataUrl"), upload: s.uploadMasterW2AgreementForm, name: nameOf(d, "master-w2-agreement") };
    }
    case "master_w2_office_agreement": {
      const t = await import("@/lib/masterW2OfficeAgreementFormTemplate");
      const l = await logos();
      return { blob: await masterAgreementPdf(doc, t.masterW2OfficeUsesAdminHub(d) ? l.ahs : l.usihs, t.buildMasterW2OfficeAgreementBodyMarkup, t.masterW2OfficeAgreementStyles, "employeeSignatureDataUrl"), upload: s.uploadMasterW2OfficeAgreementForm, name: nameOf(d, "master-w2-office-agreement") };
    }
    case "master_ph_contractor_agreement": {
      const t = await import("@/lib/masterPhContractorAgreementFormTemplate");
      const { brandOf } = await import("@/lib/formBrand");
      const l = await logos();
      return { blob: await masterAgreementPdf(doc, brandOf(d) === "ahs" ? l.ahs : l.usihs, t.buildMasterPhContractorAgreementBodyMarkup, t.masterPhContractorAgreementStyles, "contractorSignatureDataUrl"), upload: s.uploadMasterPhContractorAgreementForm, name: nameOf(d, "master-ph-contractor-agreement") };
    }
    case "direct_deposit": {
      const t = await import("@/lib/directDepositFormTemplate");
      const { brandOf } = await import("@/lib/formBrand");
      const l = await logos();
      return { blob: await simpleTemplatePdf(doc, brandOf(d) === "ahs" ? l.ahs : l.usihs, t.buildDirectDepositBodyMarkup, t.directDepositStyles), upload: s.uploadDirectDepositForm, name: nameOf(d, "direct-deposit") };
    }
    case "ssn_card_form": {
      const t = await import("@/lib/ssnCardFormTemplate");
      return { blob: await simpleTemplatePdf(doc, (await logos()).usihs, t.buildSsnCardFormBodyMarkup, t.ssnCardFormStyles, "cardPhotoUrls"), upload: s.uploadSsnCardForm, name: nameOf(d, "ssn-card") };
    }
    case "drivers_license_form": {
      const t = await import("@/lib/driversLicenseFormTemplate");
      return { blob: await simpleTemplatePdf(doc, (await logos()).usihs, t.buildDriversLicenseFormBodyMarkup, t.driversLicenseFormStyles, "licensePhotoUrls"), upload: s.uploadDriversLicenseForm, name: nameOf(d, "drivers-license") };
    }
    case "contractor_data": {
      const t = await import("@/lib/contractorDataFormTemplate");
      return { blob: await simpleTemplatePdf(doc, (await logos()).usihs, t.buildContractorDataBodyMarkup, t.contractorDataStyles), upload: s.uploadContractorDataForm, name: nameOf(d, "contractor-data") };
    }
    case "contractor_data_us": {
      const t = await import("@/lib/contractorDataUsFormTemplate");
      return { blob: await simpleTemplatePdf(doc, (await logos()).usihs, t.buildContractorDataUsBodyMarkup, t.contractorDataUsStyles), upload: s.uploadContractorDataForm, name: nameOf(d, "contractor-data-us") };
    }
    case "vehicle_use_agreement": {
      const t = await import("@/lib/vehicleUseAgreementFormTemplate");
      return { blob: await simpleTemplatePdf(doc, (await logos()).usihs, t.buildVehicleUseAgreementBodyMarkup, t.vehicleUseAgreementStyles), upload: s.uploadVehicleUseAgreementForm, name: nameOf(d, "vehicle-use-agreement") };
    }
    case "nda_form": {
      const t = await import("@/lib/ndaFormTemplate");
      const pdf = await import("@/lib/pdfCapture");
      const resolved = await pdf.resolveSignaturesForCapture(doc.signatures ?? {}, "__rebuild__", "");
      if (doc.signatures?.employee && !resolved.employee?.url?.startsWith("data:")) throw new Error(NO_SIGNATURE);
      return { blob: await pdf.captureHtmlPagesToPdfBlob(t.buildNdaFormPages(d as any, (await logos()).usihs, resolved.employee as any), t.ndaFormStyles), upload: s.uploadNdaForm, name: nameOf(d, "nda-form") };
    }
    default:
      throw new Error("This form can't be edited here.");
  }
}

// ─── Saving ─────────────────────────────────────────────────────────────────

/** `doc.formData` with these corrections (and employeeName redone the way its fill page wrote it), before the edit record. */
export function applyCorrections(doc: Pick<SignableDocument, "documentType" | "formData">, values: Record<string, string>): Record<string, any> {
  const next: Record<string, any> = { ...doc.formData, ...values };
  const style = FULL_NAME[doc.documentType];
  const nameTouched = ["firstName", "middleName", "lastName"].some((k) => k in values);
  if (style && nameTouched && "employeeName" in (doc.formData ?? {})) {
    next.employeeName = (style === "first-last" ? [next.firstName, next.lastName] : [next.firstName, next.middleName, next.lastName])
      .map((p) => text(p).trim())
      .filter(Boolean)
      .join(" ");
  }
  return next;
}

/**
 * Saves HR's corrections to a signed form: rebuilds and uploads its PDF from
 * the corrected answers, then saves the answers and the new PDF together.
 * Nothing is saved if the PDF can't be rebuilt. Returns the updated form.
 */
export async function saveSignedFormCorrections(
  doc: SignableDocument,
  values: Record<string, string>,
  editor: { profileId: string | null; name: string | null },
): Promise<SignableDocument> {
  const why = whyNotEditable(doc);
  if (why) throw new Error(why);
  const fields = editableFields(doc);
  const changes = fields
    .filter((x) => x.key in values && text(values[x.key]) !== text(doc.formData?.[x.key]))
    .map((x) => ({ key: x.key, label: x.label, from: text(doc.formData?.[x.key]), to: text(values[x.key]) }));
  if (changes.length === 0) throw new Error("Nothing was changed.");

  const corrected = applyCorrections(doc, Object.fromEntries(changes.map((c) => [c.key, c.to])));
  const record: SignedFormEdit = { at: new Date().toISOString(), byId: editor.profileId, byName: editor.name, changes };
  const formData = { ...corrected, hrEdits: [...editHistoryOf(doc), record] };
  const next: SignableDocument = { ...doc, formData };

  const { refreshStorageAuthToken } = await import("@/lib/firebase/storage");
  await refreshStorageAuthToken();
  const built = await buildPdf(next);
  const pdfUrl = await built.upload(doc.companyId, built.name, built.blob);
  await updateSignableDocumentPdfUrl(doc.id, pdfUrl, formData);

  const owner = documentOwner(doc);
  void logActivity({
    action: "signed_form_edited",
    targetType: "employee",
    targetId: owner ?? undefined,
    targetLabel: nameOf(formData, ""),
    details: { documentType: doc.documentType, documentId: doc.id, fields: [...new Set(changes.map((c) => fields.find((x) => x.key === c.key)?.field))] },
  });
  return { ...next, pdfUrl };
}
