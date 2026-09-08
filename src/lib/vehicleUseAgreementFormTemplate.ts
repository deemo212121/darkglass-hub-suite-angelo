/**
 * Vehicle Use Agreement — a brand-new document type (distinct from the
 * existing "Company Vehicle Use Agreement" / vehicle_agreement, which
 * draws onto its own real source PDF via pdf-lib and uses different
 * wording). This one has no source PDF at all — same from-scratch
 * HTML-template-captured-to-PDF technique as the Warning Form/Contractor
 * Data (see captureHtmlToPdfBlob in pdfCapture.ts), built directly from
 * the 21-clause "Contractor" agreement text as given, verbatim.
 *
 * Single-party — one contractor fills in Name/Date/Branch and signs, no
 * employer/HR co-signature step, same shape as Car IQ/Contractor Data.
 * Branch reuses the same 27-branch list every other document in this
 * family already uses (re-exported from carIqAgreementFormTemplate.ts,
 * same idiom the existing vehicle_agreement type uses).
 */

export { CAR_IQ_BRANCHES as VEHICLE_USE_AGREEMENT_BRANCHES } from "./carIqAgreementFormTemplate";

export interface VehicleUseAgreementFormData {
  /** The employee's actual profile id — not shown on the document itself, just carried alongside for lookups. */
  employeeId: string;
  /** Derived display name — [firstName, lastName].filter(Boolean).join(" "). */
  employeeName: string;
  firstName: string;
  lastName: string;
  branch: string;
  /** The form's own "Date" field (MM-DD-YYYY on the source content) — distinct from dateSigned below, which is when the signature itself was captured. */
  date: string;
  dateSigned: string;
  /** Raw canvas PNG as a data: URL — see w4FormTemplate.ts's header comment for why this is stored alongside the durable Firebase Storage signature URL. */
  signatureDataUrl: string;
}

export interface VehicleUseAgreementSignature {
  name: string;
  url: string;
  signedAt: string;
}

/** The 21 numbered guidelines, verbatim as given. */
export const VEHICLE_USE_AGREEMENT_CLAUSES: string[] = [
  "Contractor must maintain a proper and current driver’s license for the type of company vehicle that they are operating and notify management immediately if they no longer have a valid license.",
  "Contractor will notify the company of any citations received while operating a company vehicle.",
  "Contractor is responsible for maintaining a MVR within established company guidelines.",
  "Contractor must follow generally accepted safe driving practices and obey traffic regulations.",
  "Contractor will ensure that all occupants of a company owned vehicle are properly wearing safety belts while the vehicle is in motion.",
  "Contractor is responsible for ensuring that the vehicle is properly maintained. This includes having the vehicle serviced at regular service intervals by a qualified mechanic. The company will reimburse the contractor for the cost of vehicle maintenance.",
  "Contractor authorizes the company to obtain and review the Motor Vehicle Record of the contractor.",
  "The vehicle may be used for non-business use in accordance with the conditions outlined in this agreement. The contractor agrees to operate the vehicle in such a manner that will not expose the company to excessive liability or risk.",
  "Spouses may operate a company owned vehicle provided they are over the age of 25. The personal use privilege is not extended to children, parents, in-laws, brothers or sisters, or to any other person.",
  "Company owned vehicles are not be used for family vacations.",
  "Contractor is financially responsible for any parking or traffic violations while operating a company owned vehicle.",
  "Contractor must report all accidents within 12 hours of the occurrence to their manager.",
  "Contractor will be responsible to pay any deductible in the event an accident is deemed avoidable.",
  "Contractor will not make any modification or add equipment (CD players, stereos, cellular phones, etc.) to any company owned vehicles.",
  "Vehicles are not to be loaned to any persons not allowed to operate company vehicles.",
  "No non-contractors are allowed to operate vehicles.",
  "No hitchhikers are allowed in vehicles.",
  "Towing of mobile homes, travel trailers, or any type of recreational or utility trailer is prohibited.",
  "Contractor is responsible for parking cars in safe and legal areas off public ways.",
  "The use of alcohol and controlled substances prior to and during operation of any vehicle is prohibited.",
  "Any hazardous substances, chemicals or dangerous goods (as defined by law) are prohibited from being carried in a company car.",
];

const escapeHtml = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const blank = (v: string) => (v && v.trim() ? escapeHtml(v) : "&nbsp;");

const fmtDate = (v: string) => {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString();
};

export const vehicleUseAgreementStyles = `
  .vua-container * { margin: 0; padding: 0; box-sizing: border-box; }
  .vua-container { width: 816px; min-height: 1056px; background: #fff; padding: 72px; position: relative; font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 11.5px; line-height: 1.5; }
  .vua-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 18px; }
  .vua-header h1 { font-size: 19px; letter-spacing: 0.3px; }
  .vua-header img { width: 72px; height: 72px; object-fit: contain; }
  .vua-intro { margin-bottom: 14px; }
  .vua-agreement-label { font-weight: 700; margin-bottom: 8px; }
  .vua-list { list-style: decimal; padding-left: 22px; display: flex; flex-direction: column; gap: 7px; margin-bottom: 16px; }
  .vua-closing { font-style: italic; margin-bottom: 20px; }
  .vua-section-title { background: #111827; color: #fff; font-weight: 700; padding: 6px 10px; font-size: 11.5px; letter-spacing: 0.3px; margin: 18px 0 10px; }
  .vua-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; }
  .vua-row { border-bottom: 1px solid #d1d5db; padding: 5px 2px; }
  .vua-label { color: #374151; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.2px; display: block; }
  .vua-value { font-weight: 700; }
  .vua-sign-row { display: flex; gap: 24px; align-items: flex-end; border-bottom: 1px solid #9ca3af; padding: 10px 2px; margin-top: 10px; }
  .vua-sign-name { flex: 2; }
  .vua-sign-sig { flex: 1; display: flex; align-items: flex-end; }
  .vua-sign-date { flex: 1; }
  .vua-sig-img { max-height: 36px; max-width: 140px; object-fit: contain; }
`;

function field(label: string, value: string) {
  return `<div class="vua-row"><span class="vua-label">${escapeHtml(label)}</span><span class="vua-value">${blank(value)}</span></div>`;
}

export function buildVehicleUseAgreementBodyMarkup(data: VehicleUseAgreementFormData, logoDataUrl: string, signature: VehicleUseAgreementSignature | undefined): string {
  return `
    <div class="vua-container">
      <div class="vua-header">
        <h1>VEHICLE USE AGREEMENT</h1>
        ${logoDataUrl ? `<img src="${logoDataUrl}" alt="US In Home Services" />` : ""}
      </div>

      <p class="vua-intro">All contractors operating a company owned vehicle agree to operate the vehicle according to the following guidelines. Failure to adhere to these guidelines may result in revocation of a contractor's privilege to operate company vehicles or termination under some circumstances.</p>

      <p class="vua-agreement-label">Agreement:</p>
      <ol class="vua-list">
        ${VEHICLE_USE_AGREEMENT_CLAUSES.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}
      </ol>

      <p class="vua-closing">This authorization may be terminated by the company at any time.</p>

      <div class="vua-section-title">CONTRACTOR INFORMATION</div>
      <div class="vua-grid">
        ${field("First Name", data.firstName)}
        ${field("Last Name", data.lastName)}
        ${field("Date", fmtDate(data.date))}
        ${field("Branch", data.branch)}
      </div>

      <div class="vua-sign-row">
        <div class="vua-sign-name">Contractor's Signature: <strong>${blank(data.employeeName)}</strong></div>
        <div class="vua-sign-sig">${signature ? `<img class="vua-sig-img" src="${signature.url}" alt="Signature" />` : ""}</div>
        <div class="vua-sign-date">Date: ${signature ? escapeHtml(fmtDate(signature.signedAt)) : ""}</div>
      </div>
    </div>
  `;
}
