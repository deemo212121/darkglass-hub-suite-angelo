/**
 * Renders a custom form's field schema as an actual fill-out form and
 * collects responses — shared by the internal fill page
 * (routes/fill-form.$formId.tsx) and the public fill page
 * (routes/apply.$slug.tsx), which differ only in how the finished
 * responses get persisted (see those files).
 *
 * Every field's actual input is rendered by looking its type up in
 * ELEMENT_REGISTRY and using that element's own FillInput — this component
 * never switches on `field.type` itself, which is the whole point of the
 * registry (src/lib/formElements). "pageBreak" fields split the form into
 * wizard-style steps (Next/Back, Submit only on the last one); consecutive
 * fields following a "sectionCollapse" marker render inside a collapsible
 * block. Neither is rendered inline by the generic loop below.
 *
 * Validation is layered: required/type-specific emptiness → min/max length
 * → regex → the safe expression evaluator's Custom Validation Function →
 * the element's own extra validateValue (e.g. Email's domain allow/block
 * list) — see src/lib/formElements/expressions.ts for why the expression
 * layer can't execute real code. Conditional Logic (Show/Hide/Enable/
 * Disable If) and Calculation fields are evaluated against every other
 * field's current value, keyed by its human-readable Unique Field Name.
 */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import {
  ELEMENT_REGISTRY, applyFieldStyle, checkConditions, evaluateBooleanExpression, evaluateNumericExpression,
  type CustomFormField,
} from "@/lib/formElements";
import { canSignSection, hasAnswer, isSignerSectionComplete, sectionSigner, signerSectionName, splitSignerSections, type CurrentSigner, type SignerSection } from "@/lib/customFormSections";
import { CustomFormSignatureInput } from "@/components/CustomFormSignatureInput";

export type CustomFormRendererValue = any;

interface Props {
  fields: CustomFormField[];
  onSubmit: (values: Record<string, CustomFormRendererValue>, submitterName: string | null) => Promise<void>;
  /**
   * "submitter" (default) — the fill page: fields marked "Filled in by:
   * Company" are left out. "company" — HR completing a submission: ONLY
   * those fields are shown, with the submitter's answers (initialValues)
   * still feeding merge tokens and conditional logic. When the company part
   * has more than one signer section (see customFormSections.ts), sections
   * already completed show read-only and the person fills just their own.
   */
  mode?: "submitter" | "company";
  initialValues?: Record<string, CustomFormRendererValue>;
  /**
   * Paper view (the internal fill page): the form as a white document page
   * with `header` (e.g. the logo) at its top, simple answers written on a
   * line with the label underneath like the generated PDF — see .paper-sheet
   * in styles.css. Errors and the Submit button sit below the page.
   */
  paper?: { header?: ReactNode };
  /**
   * Company mode: who is completing it. A signer section whose heading names
   * its signer (config.signer — e.g. only Justin Lee, or only HR) can only be
   * signed by that person; everyone else sees "Waiting for … to sign."
   */
  signer?: CurrentSigner | null;
  /**
   * Company mode: also show the rest of the document — its text, and the
   * submitter's answers read-only (e.g. the employee's signed block) — so a
   * signer opening a direct link sees the whole thing they're signing.
   */
  showSubmitterPart?: boolean;
}

/** Answers drawn on a line with the label underneath in paper view — the rest keep their usual label-above layout. */
const PAPER_LINE_TYPES = new Set(["signature", "datePicker", "shortText", "email", "phone", "number"]);

interface FieldGroup {
  /** Set when this group came from a "sectionCollapse" marker — renders as a collapsible block with this title. */
  title?: string;
  defaultOpen?: boolean;
  fields: CustomFormField[];
}

interface FormPage {
  stepTitle?: string;
  nextButtonText?: string;
  previousButtonText?: string;
  showProgressBar?: boolean;
  groups: FieldGroup[];
}

/** Splits the flat field list into wizard pages at each "pageBreak", then groups each page's fields into collapsible sections at each "sectionCollapse". Neither marker is itself rendered as a field. */
function groupFieldsIntoPages(fields: CustomFormField[]): FormPage[] {
  const pages: FormPage[] = [];
  let currentPage: CustomFormField[] = [];
  let nextPageMeta: Partial<FormPage> = {};

  const flushPage = (meta: Partial<FormPage>) => {
    const groups: FieldGroup[] = [];
    let currentGroup: FieldGroup = { fields: [] };
    for (const f of currentPage) {
      if (f.type === "sectionCollapse") {
        if (currentGroup.fields.length > 0) groups.push(currentGroup);
        currentGroup = { title: f.config.title || "Section", defaultOpen: f.config.defaultOpen !== false, fields: [] };
        continue;
      }
      currentGroup.fields.push(f);
    }
    if (currentGroup.fields.length > 0) groups.push(currentGroup);
    pages.push({ ...meta, groups });
    currentPage = [];
  };

  for (const f of fields) {
    if (f.type === "pageBreak") {
      flushPage(nextPageMeta);
      nextPageMeta = { stepTitle: f.config.title || undefined, nextButtonText: f.config.nextButtonText, previousButtonText: f.config.previousButtonText, showProgressBar: f.config.showProgressBar };
      continue;
    }
    currentPage.push(f);
  }
  flushPage(nextPageMeta);
  return pages.length > 0 ? pages : [{ groups: [] }];
}

/** Whether the form's own fields already give deriveSubmitterName something to work with — a dedicated Full Name field, or a short text/email field clearly labeled as one. When neither exists (e.g. a form built entirely from Fill in the Blank/rating/checkbox fields), the submitter's name would otherwise be lost, showing as "Someone" everywhere it's displayed. */
function hasNameYieldingField(fields: CustomFormField[]): boolean {
  return fields.some((f) => f.type === "fullName" || ((f.type === "shortText" || f.type === "email") && /name/i.test(f.label)));
}

function deriveSubmitterName(fields: CustomFormField[], values: Record<string, any>): string | null {
  const fullName = fields.find((f) => f.type === "fullName");
  if (fullName) {
    const v = values[fullName.id];
    if (v?.first) return [v.first, v.last].filter(Boolean).join(" ");
  }
  const nameField = fields.find((f) => (f.type === "shortText" || f.type === "email") && /name/i.test(f.label));
  const v = nameField ? values[nameField.id] : null;
  return typeof v === "string" && v.trim() ? v : null;
}

interface SubmitButtonConfig { buttonLabel?: string; loadingText?: string; successMessage?: string; redirectUrl?: string; style?: "solid" | "outline"; fullWidth?: boolean }

/** The config of the LAST "submitButton" element in the whole form, if any — used for the final page's submit action. */
function findSubmitConfig(fields: CustomFormField[]): SubmitButtonConfig {
  const submitFields = fields.filter((f) => f.type === "submitButton");
  return submitFields[submitFields.length - 1]?.config ?? {};
}

/** Whether conditionalLogic makes this field visible/enabled right now — always visible/enabled when there's no logic (or it's not `hidden`). */
function computeFieldState(field: CustomFormField, valuesByName: Record<string, any>): { visible: boolean; disabled: boolean } {
  if (field.hidden) return { visible: false, disabled: false };
  if (!field.conditionalLogic) return { visible: true, disabled: false };
  const met = checkConditions(field.conditionalLogic, valuesByName);
  switch (field.conditionalLogic.action) {
    case "show": return { visible: met, disabled: false };
    case "hide": return { visible: !met, disabled: false };
    case "enable": return { visible: true, disabled: !met };
    case "disable": return { visible: true, disabled: met };
    default: return { visible: true, disabled: false };
  }
}

/** Layered validation: required/emptiness → min/max length → regex → Custom Validation Function → the element's own extra check. */
function validateFieldValue(field: CustomFormField, value: any, valuesByName: Record<string, any>): string | null {
  const def = ELEMENT_REGISTRY[field.type];
  if (!def || def.kind === "structural") return null;
  const err = field.validation.errorMessage;

  if (field.required && def.isEmptyValue(value)) return err || `"${field.label}" is required.`;
  if (typeof value === "string") {
    if (field.validation.minLength && value.length < field.validation.minLength) return err || `"${field.label}" must be at least ${field.validation.minLength} characters.`;
    if (field.validation.maxLength && value.length > field.validation.maxLength) return err || `"${field.label}" must be at most ${field.validation.maxLength} characters.`;
    if (field.validation.regex) {
      try { if (!new RegExp(field.validation.regex).test(value)) return err || `"${field.label}" is invalid.`; } catch { /* malformed regex — skip rather than block every submission */ }
    }
  }
  if (field.validation.customExpression && !evaluateBooleanExpression(field.validation.customExpression, { ...valuesByName, value })) {
    return err || `"${field.label}" is invalid.`;
  }
  if (def.validateValue) {
    const customErr = def.validateValue(value, field);
    if (customErr) return customErr;
  }
  return null;
}

/** A Signature field's printed-name line: its current value, and whether it's pre-printed (read-only). */
interface SignerName { name: string; locked: boolean }
type RowProps = { field: CustomFormField; value: any; disabled: boolean; onChange: (v: any) => void; valuesByName: Record<string, any>; signer?: SignerName };

function FieldRow({ field, value, disabled, onChange, valuesByName, signer }: RowProps) {
  const def = ELEMENT_REGISTRY[field.type];
  if (!def) return null;
  const style = applyFieldStyle(field);
  const cls = field.cssClass ? field.cssClass : undefined;

  if (def.kind === "structural" && field.type !== "submitButton") {
    return (
      <div style={style} className={cls}>
        <def.FillInput field={field} value={value} onChange={onChange} valuesByName={valuesByName} />
      </div>
    );
  }
  if (field.type === "submitButton") return null; // handled specially by the page footer, not the generic loop

  return (
    <div style={style} className={cls}>
      {/* Gutter for side-by-side fields (e.g. Signature | Date) so they don't touch. */}
      <div className={`flex flex-col gap-1.5 ${field.displayMode === "block" && field.width < 100 ? "pr-4" : ""}`}>
        <label className="text-sm font-medium flex items-center gap-1">
          {field.label}{field.required && <span className="text-red-400 ml-0.5">*</span>}
          {field.tooltip && <span title={field.tooltip} className="text-muted-foreground cursor-help">ⓘ</span>}
        </label>
        {field.description && <p className="text-xs text-muted-foreground -mt-1">{field.description}</p>}
        {field.helpText && <p className="text-xs text-muted-foreground -mt-1">{field.helpText}</p>}
        <fieldset disabled={disabled} className="contents">
          {field.type === "signature" ? (
            <CustomFormSignatureInput field={field} onChange={onChange} signerName={signer?.name} signerNameLocked={signer?.locked} />
          ) : (
            <def.FillInput field={field} value={value} onChange={onChange} valuesByName={valuesByName} />
          )}
        </fieldset>
      </div>
    </div>
  );
}

/** Paper view: the answer written on a line with its label underneath, the way the printed document reads. */
function PaperLineRow({ field, value, disabled, onChange, valuesByName, signer }: RowProps) {
  const def = ELEMENT_REGISTRY[field.type];
  if (!def) return null;
  const line = (
    <>
      <div className="paper-rule" />
      <div className="paper-label" title={field.tooltip || undefined}>
        {field.label}{field.required && !field.readonly && <span className="text-red-600 ml-0.5">*</span>}
      </div>
    </>
  );
  return (
    // Bottom-aligned (self-end) so a Date beside a Signature shares its line, as on the PDF.
    <div style={applyFieldStyle(field)} className={`paper-line-row self-end ${field.cssClass ?? ""}`}>
      <div className={`paper-line ${field.type === "signature" ? "paper-sig" : ""} ${field.displayMode === "block" && field.width < 100 ? "paper-gutter" : ""}`}>
        {/* A signature's line and label go between the pad and its Type/Draw controls. */}
        {field.type === "signature" ? (
          <fieldset disabled={disabled} className="contents">
            <CustomFormSignatureInput field={field} onChange={onChange} signerName={signer?.name} signerNameLocked={signer?.locked} belowCanvas={line} controlsFirst />
          </fieldset>
        ) : (
          <>
            <fieldset disabled={disabled} className="contents">
              <def.FillInput field={field} value={value} onChange={onChange} valuesByName={valuesByName} />
            </fieldset>
            {line}
          </>
        )}
      </div>
    </div>
  );
}

/** A field of a signer section someone already completed — shown as saved, not editable (a signature can't be redrawn over). */
function SignedFieldRow({ field, value, paper }: { field: CustomFormField; value: any; paper?: boolean }) {
  const def = ELEMENT_REGISTRY[field.type];
  const isFile = !!def?.isFileField;
  const text = def?.formatValue ? def.formatValue(value, field) : typeof value === "string" || typeof value === "number" ? String(value) : "";
  // Paper view: the saved answer on its line with the label underneath, as printed.
  if (paper && PAPER_LINE_TYPES.has(field.type)) {
    return (
      <div style={applyFieldStyle(field)} className="paper-line-row self-end">
        <div className={`paper-line ${field.displayMode === "block" && field.width < 100 ? "paper-gutter" : ""}`}>
          {isFile ? (
            value?.url ? <img src={value.url} alt={field.label} className="h-16 w-auto max-w-full" /> : <div className="h-16" />
          ) : (
            <div className="px-0.5 pb-1">{text || "\u00a0"}</div>
          )}
          <div className="paper-rule" />
          <div className="paper-label">{field.label}</div>
        </div>
      </div>
    );
  }
  return (
    <div style={applyFieldStyle(field)}>
      <div className={`flex flex-col gap-1.5 ${field.displayMode === "block" && field.width < 100 ? "pr-4" : ""}`}>
        <span className="text-sm font-medium text-muted-foreground">{field.label}</span>
        {isFile ? (
          value?.url ? <img src={value.url} alt={field.label} className="h-16 w-auto max-w-full self-start rounded-md bg-white p-1" /> : <span className="text-sm">—</span>
        ) : (
          <span className="text-sm">{text || "—"}</span>
        )}
      </div>
    </div>
  );
}

export function CustomFormRenderer({ fields: allFields, onSubmit, mode = "submitter", initialValues, paper, signer, showSubmitterPart }: Props) {
  const fields = useMemo(
    () => (mode === "company" && showSubmitterPart ? allFields : allFields.filter((f) => (mode === "company" ? f.fillBy === "company" : f.fillBy !== "company"))),
    [allFields, mode, showSubmitterPart]
  );
  const [values, setValues] = useState<Record<string, any>>(() => ({
    ...Object.fromEntries(fields.filter((f) => f.defaultValue !== undefined).map((f) => [f.id, f.defaultValue])),
    ...(initialValues ?? {}),
  }));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);

  const pages = useMemo(() => groupFieldsIntoPages(fields), [fields]);
  const isLastPage = pageIndex === pages.length - 1;
  const setValue = (id: string, v: any) => setValues((prev) => ({ ...prev, [id]: v }));

  // Only asked when the form itself has no way to identify who filled it out — a form
  // that already asks for a name (Full Name field, or a "Name"-labeled text/email field)
  // never shows this, so nobody types their name twice.
  const needsAutoName = useMemo(() => mode === "submitter" && !hasNameYieldingField(fields), [fields, mode]);
  const [autoName, setAutoName] = useState("");

  const valuesByName = useMemo(() => Object.fromEntries(allFields.map((f) => [f.name, values[f.id]])), [allFields, values]);

  // Each Signature's printed-name line (config.nameField, else the nearest
  // "Name" / "Printed Name" / "Full Name" field in its block) — its typed
  // signature is that name, as on the other HR forms.
  const signerNameFieldBySig = useMemo(() => {
    const isNameField = (g: CustomFormField) => (g.type === "shortText" || g.type === "fullName") && /^(full |printed )?name$|printed name|full name/i.test((g.label || "").trim());
    const map = new Map<string, CustomFormField>();
    allFields.forEach((f, i) => {
      if (f.type !== "signature") return;
      const named = f.config?.nameField ? allFields.find((g) => g.name === f.config.nameField) : undefined;
      if (named) { map.set(f.id, named); return; }
      for (const step of [1, -1]) {
        for (let j = i + step; j >= 0 && j < allFields.length; j += step) {
          const g = allFields[j];
          if (g.type === "heading" || g.type === "signature" || g.type === "pageBreak") break;
          if (isNameField(g)) { map.set(f.id, g); return; }
        }
      }
    });
    return map;
  }, [allFields]);
  const signerFor = (f: CustomFormField): SignerName | undefined => {
    const nameField = signerNameFieldBySig.get(f.id);
    if (!nameField) return undefined;
    const v = values[nameField.id];
    const name = typeof v === "string" ? v.trim() : v?.first ? [v.first, v.last].filter(Boolean).join(" ") : "";
    return { name, locked: !!nameField.readonly };
  };

  // Company mode with more than one signer section (e.g. the CEO, then HR),
  // or one that names its signer: a section someone already completed is
  // read-only, one that's someone else's to sign shows who it's waiting for,
  // and the person fills just their own — see customFormSections.ts.
  const signerSections = useMemo<SignerSection[]>(() => {
    if (mode !== "company") return [];
    const sections = splitSignerSections(fields.filter((f) => !f.hidden && f.fillBy === "company"));
    return sections.length > 1 || sections.some(sectionSigner) ? sections : [];
  }, [fields, mode]);
  const signedFieldIds = useMemo(
    () => new Set(signerSections.filter((s) => isSignerSectionComplete(s, initialValues ?? {})).flatMap((s) => s.fields.map((f) => f.id))),
    [signerSections, initialValues]
  );
  /** Sections still to sign that are this person's to sign. */
  const mySections = signerSections.filter((s) => !signedFieldIds.has(s.fields[0].id) && canSignSection(s, signer));
  /** …and the ones still waiting on someone else. */
  const othersSections = signerSections.filter((s) => !signedFieldIds.has(s.fields[0].id) && !canSignSection(s, signer));
  const sectionOfField = useMemo(() => new Map(signerSections.flatMap((s) => s.fields.map((f) => [f.id, s] as const))), [signerSections]);
  /** Open sections this person has started on — anything entered beyond the preset defaults (e.g. a pre-printed name). */
  const sectionsBeingSigned = () =>
    mySections.filter((s) => s.fields.some((f) => hasAnswer(f, values[f.id]) && values[f.id] !== f.defaultValue));
  const nothingForMe = signerSections.length > 0 && mySections.length === 0;

  // Calculated fields recompute from every other field's live value and are never directly edited.
  useEffect(() => {
    const patch: Record<string, any> = {};
    let changed = false;
    for (const f of fields) {
      if (!f.calculation) continue;
      const computed = evaluateNumericExpression(f.calculation, valuesByName);
      if (values[f.id] !== computed) { patch[f.id] = computed; changed = true; }
    }
    if (changed) setValues((prev) => ({ ...prev, ...patch }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuesByName]);

  const validatePage = (page: FormPage, isFirstPage: boolean): string | null => {
    if (isFirstPage && needsAutoName && !autoName.trim()) return "Please enter your name.";
    if (signerSections.length) {
      if (signerSections.every((s) => signedFieldIds.has(s.fields[0].id))) return "Every part of this form is already signed.";
      if (nothingForMe) return `Nothing here for you to sign — waiting on ${othersSections.map(signerSectionName).join(", ")}.`;
      const signing = sectionsBeingSigned();
      if (!signing.length) return "Fill in your part — sign it and add the date.";
      for (const f of signing.flatMap((s) => s.fields)) {
        if (!computeFieldState(f, valuesByName).visible) continue;
        const err = validateFieldValue(f, values[f.id], valuesByName);
        if (err) return err;
      }
      return null;
    }
    for (const group of page.groups) {
      for (const f of group.fields) {
        if (mode === "company" && f.fillBy !== "company") continue; // the submitter's part, shown read-only
        const { visible } = computeFieldState(f, valuesByName);
        if (!visible) continue;
        const err = validateFieldValue(f, values[f.id], valuesByName);
        if (err) return err;
      }
    }
    return null;
  };

  const handleNext = () => {
    const validationError = validatePage(pages[pageIndex], pageIndex === 0);
    if (validationError) { setError(validationError); return; }
    setError(null);
    setPageIndex((p) => p + 1);
  };

  const handleBack = () => { setError(null); setPageIndex((p) => Math.max(0, p - 1)); };

  const submitConfig = findSubmitConfig(fields);

  const handleSubmit = async () => {
    const validationError = validatePage(pages[pageIndex], pageIndex === 0);
    if (validationError) { setError(validationError); return; }
    setError(null);
    setSubmitting(true);
    // Signer sections: send the ones being signed (and the saved ones, unchanged) — not another signer's preset defaults.
    const sending = signerSections.length ? new Set([...signedFieldIds, ...sectionsBeingSigned().flatMap((s) => s.fields.map((f) => f.id))]) : null;
    try {
      await onSubmit(
        Object.fromEntries(fields.filter((f) => values[f.id] !== undefined && (!sending || sending.has(f.id))).map((f) => [f.id, values[f.id]])),
        needsAutoName ? autoName.trim() || null : deriveSubmitterName(fields, values)
      );
      setSubmitted(true);
      if (submitConfig.redirectUrl) window.location.href = submitConfig.redirectUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return <p className="text-sm font-semibold">✅ {submitConfig.successMessage || "Submitted — thanks!"}</p>;
  }

  const page = pages[pageIndex];

  const renderField = (f: CustomFormField) => {
    const { visible, disabled } = computeFieldState(f, valuesByName);
    if (!visible) return null;
    const Row = paper && PAPER_LINE_TYPES.has(f.type) ? PaperLineRow : FieldRow;
    const row = <Row key={f.id} field={f} value={values[f.id]} disabled={disabled} onChange={(v) => setValue(f.id, v)} valuesByName={valuesByName} signer={signerFor(f)} />;
    // The submitter's part (showSubmitterPart): text as written, answers read-only.
    if (mode === "company" && f.fillBy !== "company") {
      return ELEMENT_REGISTRY[f.type]?.kind === "structural" ? row : <SignedFieldRow key={f.id} field={f} value={values[f.id]} paper={!!paper} />;
    }
    // Someone else's part, not signed yet: just its heading and who it's waiting for.
    const section = sectionOfField.get(f.id);
    if (section && othersSections.includes(section)) {
      if (f.id !== section.fields[0].id) return null;
      return (
        <Fragment key={f.id}>
          {f.type === "heading" && row}
          <p className="w-full -mt-2 text-xs font-semibold text-amber-500">Waiting for {signerSectionName(section)} to sign.</p>
        </Fragment>
      );
    }
    if (!signedFieldIds.has(f.id)) return row;
    if (f.type === "heading") {
      return (
        <Fragment key={f.id}>
          {row}
          <p className="w-full -mt-2 text-xs font-semibold text-green-400 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Signed</p>
        </Fragment>
      );
    }
    return ELEMENT_REGISTRY[f.type]?.kind === "structural" ? row : <SignedFieldRow key={f.id} field={f} value={values[f.id]} paper={!!paper} />;
  };

  // The auto-name prompt (if needed) and this page's fields.
  const body = (
    <>
      {/* Only shown when the form has no field of its own that would identify the submitter — otherwise every submission would just show as "Someone" in the HR review list. */}
      {pageIndex === 0 && needsAutoName && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Your Name<span className="text-red-400 ml-0.5">*</span></label>
          <input
            type="text"
            value={autoName}
            onChange={(e) => setAutoName(e.target.value)}
            placeholder="Full name"
            className="glass-input text-sm py-2 px-3 rounded-md"
          />
        </div>
      )}

      {/* row-gap only (not column-gap) — spacing between stacked fields without eating into the width budget side-by-side fields (e.g. two 50%-width fields) rely on to fit exactly one row. */}
      <div className="flex flex-wrap gap-y-4">
        {page.groups.map((group, gi) =>
          group.title ? (
            <details key={gi} open={group.defaultOpen !== false} className="rounded-md border border-white/10 p-3 w-full">
              <summary className="text-sm font-semibold cursor-pointer flex items-center gap-1.5"><ChevronDown className="h-3.5 w-3.5" /> {group.title}</summary>
              <div className="flex flex-wrap gap-y-4 mt-3">
                {group.fields.map(renderField)}
              </div>
            </details>
          ) : (
            group.fields.map(renderField)
          )
        )}
      </div>
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      {pages.length > 1 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">Step {pageIndex + 1} of {pages.length}{page.stepTitle ? ` — ${page.stepTitle}` : ""}</p>
          {page.showProgressBar && (
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${((pageIndex + 1) / pages.length) * 100}%` }} />
            </div>
          )}
        </div>
      )}

      {paper ? (
        <div className="rounded-md bg-white/5 p-2 sm:p-4">
          <div className="paper-sheet">
            {paper.header}
            <div className="flex flex-col gap-4">{body}</div>
          </div>
        </div>
      ) : (
        body
      )}

      {error && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{error}</p>}

      {nothingForMe ? (
        <p className="text-xs text-muted-foreground">Nothing here for you to sign — waiting on {othersSections.map(signerSectionName).join(", ")}.</p>
      ) : (
      <div className="flex items-center gap-2">
        {pageIndex > 0 && (
          <button type="button" onClick={handleBack} disabled={submitting} className="btn text-sm px-4 py-2 flex items-center gap-1.5 disabled:opacity-50">
            <ChevronLeft className="h-3.5 w-3.5" /> {page.previousButtonText || "Back"}
          </button>
        )}
        {isLastPage ? (
          <button type="button" onClick={handleSubmit} disabled={submitting} className={`btn text-sm px-4 py-2 disabled:opacity-50 flex items-center gap-2 ${submitConfig.style === "outline" ? "border border-blue-500 text-blue-400" : "bg-blue-600 hover:bg-blue-700 text-white"} ${submitConfig.fullWidth ? "w-full justify-center" : ""}`}>
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {submitting ? (submitConfig.loadingText || "Submitting…") : (submitConfig.buttonLabel || "Submit")}
          </button>
        ) : (
          <button type="button" onClick={handleNext} className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5">
            {page.nextButtonText || "Next"} <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      )}
    </div>
  );
}
