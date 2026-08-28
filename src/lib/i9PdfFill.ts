/**
 * Fills the REAL, official USCIS Form I-9 PDF (src/assets/i-9.pdf) using its
 * own native AcroForm fields — same approach as w4PdfFill.ts/w9PdfFill.ts.
 * Unlike the IRS's W-4 (generic f1_NN names nested under XFA subforms), this
 * PDF's fields have plain, human-readable names with no subform nesting, so
 * they're referenced directly.
 *
 * Section 1 and Section 2 are both on page 1 of the 2023 USCIS revision —
 * there is no separate "page 2" for Section 2. Field names/positions were
 * extracted directly via pdf-lib's own acroField.getWidgets()[0].getRectangle(),
 * not guessed from a visual reading.
 *
 * Like every other automated form in this app, there's no real signature
 * AcroForm field to type into ("Signature of Employee"/"Signature of
 * Employer or AR" are plain text fields on the source PDF) — both hand-drawn
 * signature PNGs are instead drawn directly onto the page at those fields'
 * real rectangles, keeping the same signing UX as W-4/W-8BEN/W-9/COE.
 *
 * Called twice over a document's lifetime, both times regenerating the whole
 * PDF fresh from the local blank template (never patching an
 * already-generated file — see w4PdfFill.ts's header comment for why):
 *   1. When the employee submits Section 1 (FillI9Page.tsx) — Section 2 blank.
 *   2. When HR completes Section 2 (ReportHRDaily.tsx's "Complete Section 2"
 *      dialog) — called again with the already-stored Section 1 formData
 *      plus the newly-typed Section 2 fields, redrawing the employee's
 *      signature from formData.employeeSignatureDataUrl alongside HR's own
 *      newly-captured signature.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { I9FormData } from "./i9FormTemplate";

const fmtDate = (v: string) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
};

export async function loadBlankI9Bytes(): Promise<Uint8Array> {
  const mod = await import("@/assets/i-9.pdf");
  const res = await fetch(mod.default);
  return new Uint8Array(await res.arrayBuffer());
}

export async function fillI9Pdf(data: I9FormData, employeeSigBytes?: Uint8Array, employerSigBytes?: Uint8Array): Promise<Uint8Array> {
  const blankBytes = await loadBlankI9Bytes();
  const pdfDoc = await PDFDocument.load(blankBytes);
  const form = pdfDoc.getForm();

  const setText = (name: string, value: string) => {
    try {
      form.getTextField(name).setText(value ?? "");
    } catch (err) {
      console.error(`I-9 PDF: failed to set field ${name}:`, err);
    }
  };
  const setCheck = (name: string, checked: boolean) => {
    try {
      const box = form.getCheckBox(name);
      if (checked) box.check();
      else box.uncheck();
    } catch (err) {
      console.error(`I-9 PDF: failed to set checkbox ${name}:`, err);
    }
  };
  const setDropdown = (name: string, value: string) => {
    if (!value) return;
    try {
      form.getDropdown(name).select(value);
    } catch (err) {
      console.error(`I-9 PDF: failed to set dropdown ${name}:`, err);
    }
  };

  // ── Section 1 — Employee Information and Attestation ──
  setText("First Name Given Name", data.firstName);
  // maxLength=1 on the real PDF field — anything longer throws instead of
  // silently truncating (confirmed by direct inspection), so it's clamped
  // here rather than left to error out mid-fill.
  setText("Employee Middle Initial (if any)", (data.middleInitial || "").slice(0, 1));
  setText("Last Name (Family Name)", data.lastName);
  setText("Employee Other Last Names Used (if any)", data.otherLastNames);
  setText("Address Street Number and Name", data.address);
  setText("Apt Number (if any)", data.aptNumber);
  setText("City or Town", data.city);
  setDropdown("State", data.state);
  setText("ZIP Code", data.zip);
  setText("Date of Birth mmddyyyy", fmtDate(data.dateOfBirth));
  // maxLength=9 on the real PDF field (raw digits, no dashes) — strip any
  // formatting the employee typed rather than erroring out mid-fill.
  setText("US Social Security Number", (data.ssn || "").replace(/\D/g, "").slice(0, 9));
  setText("Employees E-mail Address", data.email);
  setText("Telephone Number", data.phone);

  setCheck("CB_1", data.citizenshipStatus === "citizen");
  setCheck("CB_2", data.citizenshipStatus === "noncitizen_national");
  setCheck("CB_3", data.citizenshipStatus === "lawful_permanent_resident");
  setCheck("CB_4", data.citizenshipStatus === "noncitizen_authorized");
  setText("3 A lawful permanent resident Enter USCIS or ANumber", data.lprANumber);
  setText("Exp Date mmddyyyy", fmtDate(data.workAuthExpDate));
  setText("USCIS ANumber", data.uscisANumber);
  setText("Form I94 Admission Number", data.i94Number);
  setText("Foreign Passport Number and Country of IssuanceRow1", data.foreignPassport);
  setText("Today's Date mmddyyy", fmtDate(data.employeeDateSigned));

  // ── Section 2 — Employer Review and Verification ──
  setText("Document Title 1", data.listADocTitle1);
  setText("Issuing Authority 1", data.listAIssuing1);
  setText("Document Number 0 (if any)", data.listADocNumber1);
  setText("Expiration Date if any", fmtDate(data.listAExp1));
  setText("Document Title 2 If any", data.listADocTitle2);
  setText("Issuing Authority_2", data.listAIssuing2);
  setText("Document Number If any_2", data.listADocNumber2);
  setText("List A.  Document 2. Expiration Date (if any)", fmtDate(data.listAExp2));
  setText("List A.   Document Title 3.  If any", data.listADocTitle3);
  setText("List A. Document 3.  Enter Issuing Authority", data.listAIssuing3);
  setText("List A.  Document 3 Number.  If any", data.listADocNumber3);
  // Misnamed on the real USCIS PDF (reads "Document Number if any_3") but
  // positioned as List A row 3's expiration date — confirmed by rectangle.
  setText("Document Number if any_3", fmtDate(data.listAExp3));

  setText("List B Document 1 Title", data.listBDocTitle1);
  setText("List B Issuing Authority 1", data.listBIssuing1);
  setText("List B Document Number 1", data.listBDocNumber1);
  setText("List B Expiration Date 1", fmtDate(data.listBExp1));
  setText("List C Document Title 1", data.listCDocTitle1);
  setText("List C Issuing Authority 1", data.listCIssuing1);
  setText("List C Document Number 1", data.listCDocNumber1);
  setText("List C Expiration Date 1", fmtDate(data.listCExp1));

  setText("Additional Information", data.additionalInfo);
  setCheck("CB_Alt", data.altProcedureCheckbox);
  setText("FirstDayEmployed mmddyyyy", fmtDate(data.firstDayEmployed));
  setText("S2 Todays Date mmddyyyy", fmtDate(data.section2DateSigned));
  setText("Last Name First Name and Title of Employer or Authorized Representative", data.employerNameTitle);
  setText("Employers Business or Org Name", data.businessName);
  setText("Employers Business or Org Address", data.businessAddress);

  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  form.updateFieldAppearances(helveticaBold);

  // Signatures — drawn directly onto the page, same convention as
  // W-4/W-8BEN/W-9 (see header comment: neither signature field is a real
  // AcroForm signature widget).
  const page1 = pdfDoc.getPage(0);
  if (employeeSigBytes) {
    const png = await pdfDoc.embedPng(employeeSigBytes);
    const maxW = 300;
    const maxH = 13;
    page1.drawImage(png, { x: 44, y: 421, width: maxW, height: maxH });
  }
  if (employerSigBytes) {
    const png = await pdfDoc.embedPng(employerSigBytes);
    const maxW = 185;
    const maxH = 18;
    page1.drawImage(png, { x: 296, y: 82, width: maxW, height: maxH });
  }

  // Locking every field is safe now regardless of whether Section 2 is
  // filled yet — HR never edits this generated PDF directly (fillI9Pdf is
  // always re-run from scratch instead), so there's no more "must stay
  // editable for later" case.
  for (const field of form.getFields()) {
    field.enableReadOnly();
  }

  return pdfDoc.save();
}
