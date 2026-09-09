/**
 * Non-Disclosure Agreement — page 1, rendered with the blank fields as real
 * editable controls sitting directly in the document flow, instead of a
 * separate fill-form panel stacked above a static preview. Same editing feel
 * as FillContractorAddendumPage.tsx (inputs positioned right on the blank
 * lines of the document being signed) — but since the NDA is built from live
 * HTML/CSS (see ndaFormTemplate.ts) rather than a flattened PDF image, the
 * inputs can sit in normal document flow instead of needing pixel-rect
 * overlays. Pages 2-4 have nothing to fill in, so they stay the plain
 * dangerouslySetInnerHTML preview from buildNdaFormPages.
 *
 * Shared by SignNdaFormPage.tsx and ExternalSignNdaFormPage.tsx so the two
 * editing surfaces can never drift apart.
 */
import { NDA_BRANCHES, EMPLOYER_NAME, EMPLOYER_ADDRESS, type NdaFormData } from "@/lib/ndaFormTemplate";

interface Props {
  data: NdaFormData;
  logoDataUrl: string;
  updateField: <K extends keyof NdaFormData>(key: K, value: NdaFormData[K]) => void;
  /** Live preview of whatever's currently on the signature pad (drawn or typed) — shown here the same way it'll be stamped on the actual PDF, so the recipient sees it land on page 1 as soon as they sign at the end. */
  signatureUrl?: string;
}

const cellInputCls =
  "bg-blue-50/70 border border-blue-300/70 rounded-[2px] outline-none px-1 font-bold font-sans text-[#00008B] focus:bg-blue-100/80 focus:border-blue-400 w-full";

/** ISO datetime string -> yyyy-mm-dd for a native date input's value. */
function toDateInputValue(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

export function NdaPage1Editable({ data, logoDataUrl, updateField, signatureUrl }: Props) {
  return (
    <div className="nda-container">
      <div className="nda-header">
        {logoDataUrl && <img src={logoDataUrl} alt="US In Home Services" />}
        <h1>Non-Disclosure Agreement</h1>
        <p className="nda-subtitle">Please make sure to fill out the form correctly. Thank you!</p>
      </div>

      <p className="nda-intro">
        This agreement is made and entered into as of{" "}
        <input
          type="date"
          value={toDateInputValue(data.dateSigned)}
          onChange={(e) => updateField("dateSigned", e.target.value ? new Date(`${e.target.value}T00:00:00`).toISOString() : "")}
          className={cellInputCls}
          style={{ display: "inline-block", width: "140px" }}
        />
        , by and between:
      </p>

      <div className="nda-section-title">1. Parties</div>
      <div className="nda-party-block">
        <p className="nda-party-label">Employer:</p>
        <p>Company Name: {EMPLOYER_NAME}</p>
        <p>Address: {EMPLOYER_ADDRESS}</p>
      </div>
      <div className="nda-party-block">
        <p className="nda-party-label">Contractor:</p>
        <div className="nda-field-row">
          <div>
            <span className="nda-field-label">Full Name:</span>{" "}
            <input value={data.employeeName} onChange={(e) => updateField("employeeName", e.target.value)} className={cellInputCls} placeholder="Full Name*" />
          </div>
          <div>
            <span className="nda-field-label">Nationality:</span>{" "}
            <input value={data.nationality} onChange={(e) => updateField("nationality", e.target.value)} className={cellInputCls} placeholder="Nationality*" />
          </div>
        </div>
        <div className="nda-field-row">
          <div>
            <span className="nda-field-label">Street Address:</span>{" "}
            <input value={data.address} onChange={(e) => updateField("address", e.target.value)} className={cellInputCls} placeholder="Street Address*" />
          </div>
        </div>
        <div className="nda-field-row">
          <div>
            <span className="nda-field-label">City:</span>{" "}
            <input value={data.city} onChange={(e) => updateField("city", e.target.value)} className={cellInputCls} placeholder="City*" />
          </div>
          <div>
            <span className="nda-field-label">State:</span>{" "}
            <input value={data.state} onChange={(e) => updateField("state", e.target.value)} className={cellInputCls} placeholder="State*" />
          </div>
          <div>
            <span className="nda-field-label">Zip:</span>{" "}
            <input value={data.zip} onChange={(e) => updateField("zip", e.target.value)} className={cellInputCls} placeholder="Zip*" />
          </div>
        </div>
        <div className="nda-field-row">
          <div>
            <span className="nda-field-label">Branch (leave blank if PH):</span>{" "}
            <select value={data.branch} onChange={(e) => updateField("branch", e.target.value)} className={cellInputCls} style={{ display: "inline-block", width: "auto" }}>
              <option value="">Please Select</option>
              {NDA_BRANCHES.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="nda-section-title">2. Purpose</div>
      <p>The employer may disclose certain confidential or proprietary information to the contractor during their employment as an appliance technician. The contractor agrees to keep this information secret and use it only for their job responsibilities.</p>

      <div className="nda-section-title">3. Definition of Confidential Information</div>
      <p>Includes but is not limited to:</p>
      <ul className="nda-bullet-list">
        <li>Customer data, service records</li>
        <li>Technical processes, manuals, and methods</li>
        <li>Business strategies and pricing</li>
        <li>Tools, equipment specifications, and repair techniques</li>
        <li>Any non-public information shared orally, in writing, or electronically</li>
      </ul>

      <div className="nda-sign-row">
        <div className="nda-sign-sig">
          Contractor Signature:{" "}
          {signatureUrl ? (
            <img className="nda-sig-img" src={signatureUrl} alt="Signature" />
          ) : (
            <span className="text-gray-400 italic text-xs">Signature*</span>
          )}
        </div>
        <div className="nda-sign-date">
          Date:{" "}
          <input
            type="date"
            value={toDateInputValue(data.dateSigned)}
            onChange={(e) => updateField("dateSigned", e.target.value ? new Date(`${e.target.value}T00:00:00`).toISOString() : "")}
            className={cellInputCls}
            style={{ display: "inline-block", width: "140px" }}
          />
        </div>
      </div>
    </div>
  );
}
