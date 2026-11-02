/**
 * Master Philippines Independent Contractor & Anti-Cloning Agreement — an
 * Admin Hub Solutions form, sent from HR Paperworks → AHS Forms PH. Wording
 * transcribed verbatim (bold included) from the PDF HR supplied 2026-11-02.
 *
 * Same HTML/CSS → PDF technique and two-party flow as the Master
 * Confidentiality agreement (confidentialityNonCompeteAgreementFormTemplate.ts):
 * the contractor fills in their name, start date and role and signs
 * (FillPhAntiCloningAgreementPage.tsx), then the Company representative —
 * Shin Seo (Executive Management), printed on the form — countersigns from
 * HR Paperworks (ReportHRDaily.tsx's "Add Employer Signature" dialog).
 * Two pages: the agreement, then the acknowledgment and signatures.
 */

import { captureHtmlPagesToPdfBlob } from "./pdfCapture";

export interface PhAntiCloningAgreementFormData {
  /** The contractor's profile id — not shown on the document, carried along for lookups. */
  employeeId: string;
  /** "Contractor Name" at the top — also the "Printed Name" by the signature. */
  employeeName: string;
  /** "Start Date" — ISO date. */
  startDate: string;
  /** "Role / Position". */
  rolePosition: string;
  employeeDateSigned: string;
  employeeSignatureDataUrl: string;
  employerDateSigned: string;
  employerSignatureDataUrl: string;
  /** "Name / Title" by the Company signature — printed on the form as PH_ANTI_CLONING_COMPANY_SIGNER. */
  employerPrintedNameTitle: string;
  /** Always "ahs" — an Admin Hub Solutions form (lib/formBrand.ts). */
  brand?: "ahs";
}

export const PH_ANTI_CLONING_AGREEMENT_TITLE = "Master Philippines Independent Contractor & Anti-Cloning Agreement";
/** The Company representative printed on the form. */
export const PH_ANTI_CLONING_COMPANY_SIGNER = "Shin Seo (Executive Management)";

const escapeHtml = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** "2026-11-02" (or a full timestamp) → "November 2, 2026". */
function fullDate(iso: string): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// How far typed text is raised above its line in the PDF (see .pac-pdf below).
const PDF_TEXT_LIFT = 6;

export const phAntiCloningAgreementStyles = `
  .pac-container * { margin: 0; padding: 0; box-sizing: border-box; }
  /* border-box: the PDF capture renders into an 816px-wide frame, so the
     page — margins included — must fit inside 816px or its right edge is cut. */
  .pac-container { box-sizing: border-box; width: 816px; background: #fff; padding: 64px 72px; position: relative; font-family: Calibri, Carlito, Arial, Helvetica, sans-serif; color: #111827; font-size: 12.5px; line-height: 1.55; }
  .pac-header { text-align: center; margin-bottom: 14px; }
  /* font-weight set here — the app's base styles reset headings to normal weight. */
  .pac-header h1 { font-size: 13.5px; font-weight: 700; letter-spacing: 0.1px; line-height: 1.35; text-align: left; margin-top: 8px; }
  .pac-section-title { font-weight: 700; margin: 12px 0 4px; }
  .pac-bullet { padding: 3px 0 3px 30px; position: relative; }
  .pac-bullet::before { content: "•"; position: absolute; left: 12px; }
  .pac-sub { padding: 3px 0 3px 64px; position: relative; }
  .pac-sub::before { content: "o"; position: absolute; left: 46px; font-size: 11px; top: 3px; }
  .pac-p { margin: 6px 0; }
  .pac-fill { font-weight: 400; border-bottom: 1px solid #111827; padding: 0 3px 1px; }
  .pac-line { display: inline-block; border-bottom: 1px solid #111827; vertical-align: bottom; }
  .pac-sign-row { display: flex; align-items: flex-end; gap: 6px; }
  /* Signature lines are taller (room for the signature) — keep the bullet by the label at the bottom. */
  .pac-sign::before { top: auto; bottom: 6px; }
  .pac-val { display: inline-flex; align-items: flex-end; min-height: 30px; border-bottom: 1px solid #111827; padding: 0 3px; }
  .pac-sig-img { max-height: 34px; max-width: 180px; object-fit: contain; }
  /* PDF pages: exactly one US Letter page each (816 x 1056 at 96dpi). */
  .pac-page { height: 1056px; overflow: hidden; }
  .pac-page-footer { position: absolute; left: 0; right: 0; bottom: 28px; text-align: center; font-size: 9.5px; color: #6b7280; }
  /* PDF only: the capture (html2canvas) draws text a few px lower than the
     browser lays it out, so typed values would sit on their lines. Lift the
     text — never the signature images, which already sit right. */
  .pac-pdf .pac-fill { padding-bottom: ${PDF_TEXT_LIFT}px; }
  .pac-pdf .pac-val-text { padding-bottom: ${PDF_TEXT_LIFT}px; }
`;

// Where the PDF splits into page 2 (an HTML comment — invisible on screen).
const PAGE_BREAK = "<!--pac-page-break-->";

/** A typed value on its line, or an empty line to write on. */
const fill = (v: string, width = 260) =>
  v && v.trim() ? `<span class="pac-fill">${escapeHtml(v.trim())}</span>` : `<span class="pac-line" style="min-width:${width}px">&nbsp;</span>`;

/** "Label: [value on a line]" — a signature image or typed text. */
function signLine(label: string, inner: string, minWidth: number, isText: boolean) {
  return `<p class="pac-bullet pac-sign"><span class="pac-sign-row"><b>${escapeHtml(label)}:</b> <span class="pac-val${isText ? " pac-val-text" : ""}" style="min-width:${minWidth}px">${inner || "&nbsp;"}</span></span></p>`;
}

export function buildPhAntiCloningAgreementBodyMarkup(data: PhAntiCloningAgreementFormData, logoDataUrl: string): string {
  const sig = (url: string) => (url ? `<img class="pac-sig-img" src="${url}" alt="Signature" />` : "");
  const text = (v: string) => (v ? escapeHtml(v) : "");
  return `
    <div class="pac-container">
      <div class="pac-header">
        ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Admin Hub Solutions" style="width:56px;height:56px;object-fit:contain;" />` : ""}
        <h1>MASTER PHILIPPINES INDEPENDENT CONTRACTOR &amp; ANTI-CLONING AGREEMENT</h1>
      </div>

      <p class="pac-bullet"><b>Contractor Name:</b> ${fill(data.employeeName)}</p>
      <p class="pac-bullet"><b>Start Date:</b> ${fill(fullDate(data.startDate), 200)}</p>
      <p class="pac-bullet"><b>Role / Position:</b> ${fill(data.rolePosition)}</p>

      <p class="pac-section-title">SECTION 1. INDEPENDENT CONTRACTOR RELATIONSHIP</p>
      <p class="pac-bullet"><b>1.1 B2B Status:</b> You are engaged strictly as an independent contractor providing remote administrative or technical support services to <b>Admin Hub Solutions</b> (the <b>"Company"</b>), and not as a regular employee under local Philippine labor codes.</p>
      <p class="pac-bullet"><b>1.2 Taxes:</b> You are solely responsible for all personal income taxes and local statutory filings (SSS, PhilHealth, Pag-IBIG).</p>

      <p class="pac-section-title">SECTION 2. CONFIDENTIALITY &amp; ANTI-CLONING</p>
      <p class="pac-bullet"><b>2.1 Confidential Information:</b> Includes BPO workflows, customer data, pricing, and the Company’s proprietary software platform, source code, UI/UX designs, and screen layouts.</p>
      <p class="pac-bullet"><b>2.2 Absolute Prohibition on Software Cloning:</b> During this engagement and <b>indefinitely thereafter</b>, Contractor shall NOT:</p>
      <p class="pac-sub">(a) copy, clone, replicate, or imitate the functional workflows, UI/UX designs, or software logic of the Company platform;</p>
      <p class="pac-sub">(b) assist any third party or competitor in building any software or system that mirrors the Company’s platform; or</p>
      <p class="pac-sub">(c) share login credentials, screenshots, or system workflows with any unauthorized individual or external developer.</p>
      <p class="pac-bullet"><b>2.3 Exclusive IP Ownership:</b> All custom features, code, modifications, and system workflows created or touched by Contractor during their engagement are and shall remain 100% the exclusive intellectual property of the Company.</p>

      <p class="pac-section-title">SECTION 3. GOVERNING LAW &amp; JURISDICTION</p>
      <p class="pac-bullet">This Agreement and the business relationship shall be governed by the laws of the <b>State of Tennessee, USA</b>, and any legal proceedings shall take place exclusively in <b>Shelby County, Tennessee</b>.</p>

      ${PAGE_BREAK}
      <p class="pac-p" style="margin-top:14px"><b>CONTRACTOR ACKNOWLEDGMENT &amp; SIGNATURE</b> By signing below, I certify that I have read, understood, and voluntarily agree to all terms, including Independent Contractor status, Confidentiality, and Anti-Cloning protections.</p>
      ${signLine("Contractor Signature", sig(data.employeeSignatureDataUrl), 230, false)}
      ${signLine("Printed Name", text(data.employeeName), 290, true)}
      ${signLine("Date", text(fullDate(data.employeeDateSigned)), 340, true)}
      ${signLine("Company Representative Signature", sig(data.employerSignatureDataUrl), 170, false)}
      <p class="pac-bullet"><b>Name / Title:</b> ${escapeHtml(data.employerPrintedNameTitle || PH_ANTI_CLONING_COMPANY_SIGNER)}</p>
      ${signLine("Date", text(fullDate(data.employerDateSigned)), 340, true)}
    </div>
  `;
}

/** The same document as US Letter pages, each with "Page X of N" — for the PDF (the preview stays one continuous page). */
export function buildPhAntiCloningAgreementPages(data: PhAntiCloningAgreementFormData, logoDataUrl: string): string[] {
  const full = buildPhAntiCloningAgreementBodyMarkup(data, logoDataUrl);
  const open = full.indexOf(`<div class="pac-container">`) + `<div class="pac-container">`.length;
  const close = full.lastIndexOf("</div>");
  const parts = full.slice(open, close).split(PAGE_BREAK);
  return parts.map((inner, i) => `<div class="pac-container pac-page pac-pdf">${inner}<div class="pac-page-footer">Page ${i + 1} of ${parts.length}</div></div>`);
}

/** The finished PDF — real Letter pages. */
export function capturePhAntiCloningAgreementPdf(data: PhAntiCloningAgreementFormData, logoDataUrl: string): Promise<Blob> {
  return captureHtmlPagesToPdfBlob(buildPhAntiCloningAgreementPages(data, logoDataUrl), phAntiCloningAgreementStyles);
}
