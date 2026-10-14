/**
 * Custom Forms → a form's "View" button: who has signed it. One card per
 * submission — the person who filled it in, then each company part in
 * signing order (e.g. HR, then the CEO): signed (printed name and date, from
 * that part's own Name / Date lines), waiting for its signer, or not open yet
 * because an earlier signer hasn't signed (config.signer.order — see
 * customFormSections.ts).
 */
import { CheckCircle2, Clock, FileDown, Link2, Lock, X } from "lucide-react";
import { ELEMENT_REGISTRY, type CustomFormField } from "@/lib/formElements";
import { companyFields, isAwaitingCompany, type CustomForm, type CustomFormSubmission } from "@/lib/supabase/customForms";
import {
  inSigningOrder, isSectionsTurn, isSignerSectionComplete, sectionsBefore, signerSectionName, splitSignerSections, type SignerSection,
} from "@/lib/customFormSections";

/** The submitter's own part's title (its first heading that isn't a company heading — e.g. "EMPLOYEE"), else "Filled in by". */
function submitterPartName(form: CustomForm): string {
  const company = new Set(companyFields(form).map((f) => f.id));
  const headings = form.fields.filter((f) => f.type === "heading" && !f.hidden && !company.has(f.id));
  // The submitter's signing block is the last non-company heading before their signature (the first ones are usually the document's title).
  const sigIndex = form.fields.findIndex((f) => f.type === "signature" && !company.has(f.id));
  const before = sigIndex >= 0 ? headings.filter((h) => form.fields.indexOf(h) < sigIndex) : [];
  const text = String(before[before.length - 1]?.config?.text ?? "").trim();
  return text && before.length > 1 ? text : "Filled in by";
}

const valueText = (field: CustomFormField | undefined, value: unknown): string => {
  if (!field || value == null || value === "") return "";
  const def = ELEMENT_REGISTRY[field.type];
  return def?.formatValue ? def.formatValue(value, field) : typeof value === "string" ? value : "";
};

/** "Justin Lee · 10/14/2026" from the part's own Name and Date lines. */
function signedBy(section: SignerSection, responses: Record<string, unknown>): string {
  const nameField = section.fields.find((f) => (f.type === "shortText" || f.type === "fullName") && /name/i.test(f.label || ""));
  const dateField = section.fields.find((f) => f.type === "datePicker");
  return [valueText(nameField, nameField ? responses[nameField.id] : null), valueText(dateField, dateField ? responses[dateField.id] : null)].filter(Boolean).join(" · ");
}

export function CustomFormSignersModal({
  form,
  submissions,
  onClose,
  onViewPdf,
  onCopySigningLink,
  copiedSigningLinkId,
}: {
  form: CustomForm;
  submissions: CustomFormSubmission[];
  onClose: () => void;
  onViewPdf: (s: CustomFormSubmission) => void;
  onCopySigningLink: (s: CustomFormSubmission) => void;
  copiedSigningLinkId: string | null;
}) {
  const sections = splitSignerSections(companyFields(form));
  const ordered = inSigningOrder(sections);
  const firstPart = submitterPartName(form);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-white/10 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-sm">Who has signed — {form.title}</h3>
            <p className="text-[10px] text-muted-foreground">
              {submissions.length} submission{submissions.length === 1 ? "" : "s"}
              {ordered.length ? ` · signed in order: ${[firstPart === "Filled in by" ? "the person filling it in" : firstPart, ...ordered.map(signerSectionName)].join(" → ")}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 overflow-y-auto space-y-3">
          {submissions.length === 0 && <p className="text-sm text-muted-foreground">No one has filled this form in yet.</p>}
          {submissions.map((s) => {
            const awaiting = isAwaitingCompany(form, s);
            return (
              <div key={s.id} className="rounded-md border border-white/10 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-sm font-semibold">{s.submitterName || "Someone"}</p>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${awaiting ? "bg-amber-500/15 text-amber-300" : "bg-green-500/15 text-green-300"}`}>
                    {awaiting ? "Awaiting signatures" : "Fully signed"}
                  </span>
                </div>
                <ul className="space-y-1.5 text-xs">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
                    <span className="text-muted-foreground w-28 shrink-0">{firstPart}</span>
                    <span>{s.submitterName || "Someone"} · {new Date(s.submittedAt).toLocaleDateString()}</span>
                  </li>
                  {ordered.map((sec, i) => {
                    const name = signerSectionName(sec);
                    const done = isSignerSectionComplete(sec, s.responses) || (!!s.completedAt && sections.length === 1);
                    const turn = isSectionsTurn(sec, sections, s.responses);
                    const pendingBefore = sectionsBefore(sec, sections).filter((b) => !isSignerSectionComplete(b, s.responses));
                    return (
                      <li key={i} className="flex items-center gap-2">
                        {done ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" /> : turn ? <Clock className="h-3.5 w-3.5 text-amber-400 shrink-0" /> : <Lock className="h-3.5 w-3.5 text-slate-500 shrink-0" />}
                        <span className="text-muted-foreground w-28 shrink-0 truncate" title={String(sec.heading?.config?.text ?? name)}>{name}</span>
                        <span className={done ? "" : "text-muted-foreground"}>
                          {done
                            ? signedBy(sec, s.responses) || (s.completedByName ? `${s.completedByName}${s.completedAt ? ` · ${new Date(s.completedAt).toLocaleDateString()}` : ""}` : "Signed")
                            : turn ? "Waiting to sign" : `Signs after ${inSigningOrder(pendingBefore).map(signerSectionName).join(", ")}`}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex items-center gap-1.5 mt-3">
                  <button type="button" onClick={() => onViewPdf(s)} className="btn text-xs px-2.5 py-1 flex items-center gap-1">
                    <FileDown className="h-3 w-3" /> View PDF
                  </button>
                  {awaiting && (
                    <button type="button" onClick={() => onCopySigningLink(s)} className="btn text-xs px-2.5 py-1 flex items-center gap-1">
                      {copiedSigningLinkId === s.id ? <><CheckCircle2 className="h-3 w-3 text-green-400" /> Copied</> : <><Link2 className="h-3 w-3" /> Copy signing link</>}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
