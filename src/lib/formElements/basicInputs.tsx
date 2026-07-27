/**
 * "Basic Inputs" category — see src/lib/formElements/index.ts for the full
 * category list/order. Dropdown/Single/Multiple Choice reuse
 * makeOptionsElement; Paragraph reuses makeDisplayElement. The rest are
 * genuinely different shapes. Label/Placeholder/Required/Readonly/etc are
 * shared properties (see CustomFormBuilder.tsx's General tab) — these
 * PropertiesPanels only cover genuinely type-specific settings.
 */
import { useState } from "react";
import {
  AlignLeft, Type, ChevronDownSquare, CircleDot, CheckSquare, Hash, Image as ImageIcon,
  Upload, Clock, ShieldCheck, ChevronsUpDown, Send,
} from "lucide-react";
import { defaultEmptyCheck, type ElementDefinition } from "./types";
import { makeOptionsElement, makeDisplayElement } from "./factories";
import { uploadCustomFormAsset } from "@/lib/firebase/storage";
import { useAuth } from "@/lib/auth";

export const shortTextElement: ElementDefinition = {
  type: "shortText",
  label: "Short Text",
  icon: Type,
  category: "basicInputs",
  kind: "field",
  defaultConfig: () => ({ prefix: "", suffix: "", showCounter: false }),
  CanvasPreview: ({ field, config }) => (
    <div className="flex items-center gap-1 text-sm text-slate-400">
      {config.prefix && <span>{config.prefix}</span>}
      <input type="text" disabled placeholder={field.placeholder || "Your answer"} className="flex-1 max-w-sm border-0 border-b border-slate-300 bg-transparent py-1" />
      {config.suffix && <span>{config.suffix}</span>}
    </div>
  ),
  PropertiesPanel: ({ field, onChange }) => (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Prefix</label><input type="text" value={field.config.prefix ?? ""} onChange={(e) => onChange({ ...field, config: { ...field.config, prefix: e.target.value } })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
        <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Suffix</label><input type="text" value={field.config.suffix ?? ""} onChange={(e) => onChange({ ...field, config: { ...field.config, suffix: e.target.value } })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={!!field.config.showCounter} onChange={(e) => onChange({ ...field, config: { ...field.config, showCounter: e.target.checked } })} /> Show Character Counter
      </label>
    </div>
  ),
  FillInput: ({ field, value, onChange }) => (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        {field.config.prefix && <span className="text-sm text-muted-foreground">{field.config.prefix}</span>}
        <input type="text" value={value ?? ""} readOnly={field.readonly} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} maxLength={field.validation?.maxLength} className="glass-input text-sm py-2 px-3 rounded-md flex-1" />
        {field.config.suffix && <span className="text-sm text-muted-foreground">{field.config.suffix}</span>}
      </div>
      {field.config.showCounter && <span className="text-[10px] text-muted-foreground self-end">{(value ?? "").length}{field.validation?.maxLength ? ` / ${field.validation.maxLength}` : ""}</span>}
    </div>
  ),
  isEmptyValue: defaultEmptyCheck,
};

export const longTextElement: ElementDefinition = {
  type: "longText",
  label: "Long Text",
  icon: AlignLeft,
  category: "basicInputs",
  kind: "field",
  defaultConfig: () => ({ rows: 4, resize: true, showCounter: false }),
  CanvasPreview: () => <div className="w-full max-w-md h-14 border-b border-slate-300 text-sm text-slate-400 py-1">Long answer text</div>,
  PropertiesPanel: ({ field, onChange }) => (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Rows</label><input type="number" min={2} value={field.config.rows ?? 4} onChange={(e) => onChange({ ...field, config: { ...field.config, rows: Number(e.target.value) } })} className="glass-input text-sm py-1.5 px-2 rounded-md w-24" /></div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={field.config.resize !== false} onChange={(e) => onChange({ ...field, config: { ...field.config, resize: e.target.checked } })} /> Allow Resize</label>
      <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={!!field.config.showCounter} onChange={(e) => onChange({ ...field, config: { ...field.config, showCounter: e.target.checked } })} /> Show Character Counter</label>
    </div>
  ),
  FillInput: ({ field, value, onChange }) => (
    <div className="flex flex-col gap-1">
      <textarea
        value={value ?? ""}
        readOnly={field.readonly}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        maxLength={field.validation?.maxLength}
        rows={field.config.rows ?? 4}
        style={{ resize: field.config.resize === false ? "none" : "vertical" }}
        className="glass-input text-sm py-2 px-3 rounded-md w-full"
      />
      {field.config.showCounter && <span className="text-[10px] text-muted-foreground self-end">{(value ?? "").length}{field.validation?.maxLength ? ` / ${field.validation.maxLength}` : ""}</span>}
    </div>
  ),
  isEmptyValue: defaultEmptyCheck,
};

export const dropdownElement = makeOptionsElement({ type: "dropdown", label: "Dropdown", icon: ChevronDownSquare, mode: "select", category: "basicInputs" });
export const singleChoiceElement = makeOptionsElement({ type: "singleChoice", label: "Single Choice", icon: CircleDot, mode: "radio", category: "basicInputs" });
export const multipleChoiceElement = makeOptionsElement({ type: "multipleChoice", label: "Multiple Choice", icon: CheckSquare, mode: "checkboxes", category: "basicInputs" });
export const paragraphElement = makeDisplayElement({ type: "paragraph", label: "Paragraph", icon: AlignLeft, category: "basicInputs", variant: "paragraph", defaultText: "Paragraph text" });

export const numberElement: ElementDefinition = {
  type: "number",
  label: "Number",
  icon: Hash,
  category: "basicInputs",
  kind: "field",
  defaultConfig: () => ({ min: undefined, max: undefined, decimals: 0, step: 1, prefix: "", suffix: "" }),
  CanvasPreview: ({ field, config }) => (
    <div className="flex items-center gap-1 text-sm text-slate-400">
      {config.prefix && <span>{config.prefix}</span>}
      <input type="number" disabled placeholder={field.placeholder || "0"} className="w-32 border-0 border-b border-slate-300 bg-transparent py-1" />
      {config.suffix && <span>{config.suffix}</span>}
    </div>
  ),
  PropertiesPanel: ({ field, onChange }) => {
    const set = (patch: Record<string, any>) => onChange({ ...field, config: { ...field.config, ...patch } });
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Min</label><input type="number" value={field.config.min ?? ""} onChange={(e) => set({ min: e.target.value ? Number(e.target.value) : undefined })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Max</label><input type="number" value={field.config.max ?? ""} onChange={(e) => set({ max: e.target.value ? Number(e.target.value) : undefined })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Decimals</label><input type="number" min={0} max={6} value={field.config.decimals ?? 0} onChange={(e) => set({ decimals: Number(e.target.value) })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Step</label><input type="number" value={field.config.step ?? 1} onChange={(e) => set({ step: Number(e.target.value) })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Prefix (e.g. $)</label><input type="text" value={field.config.prefix ?? ""} onChange={(e) => set({ prefix: e.target.value })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Suffix (e.g. kg)</label><input type="text" value={field.config.suffix ?? ""} onChange={(e) => set({ suffix: e.target.value })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
        </div>
      </div>
    );
  },
  FillInput: ({ field, value, onChange }) => (
    <div className="flex items-center gap-1.5">
      {field.config.prefix && <span className="text-sm text-muted-foreground">{field.config.prefix}</span>}
      <input
        type="number"
        value={value ?? ""}
        readOnly={field.readonly}
        min={field.config.min}
        max={field.config.max}
        step={field.config.step || Math.pow(10, -(field.config.decimals ?? 0))}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        placeholder={field.placeholder}
        className="glass-input text-sm py-2 px-3 rounded-md w-32"
      />
      {field.config.suffix && <span className="text-sm text-muted-foreground">{field.config.suffix}</span>}
    </div>
  ),
  isEmptyValue: defaultEmptyCheck,
};

export const imageElement: ElementDefinition = {
  type: "image",
  label: "Image",
  icon: ImageIcon,
  category: "basicInputs",
  kind: "structural",
  defaultConfig: () => ({ url: "", alignment: "left", rounded: false, caption: "" }),
  CanvasPreview: ({ config }) =>
    config.url ? (
      <figure style={{ textAlign: config.alignment || "left" }}>
        <img src={config.url} alt="" style={{ width: config.width || undefined, height: config.height || undefined, borderRadius: config.rounded ? 8 : 0 }} className="max-h-40 inline-block" />
        {config.caption && <figcaption className="text-xs text-slate-400 mt-1">{config.caption}</figcaption>}
      </figure>
    ) : (
      <div className="w-full h-24 rounded-md border border-dashed border-slate-300 flex items-center justify-center text-xs text-slate-400">No image set</div>
    ),
  PropertiesPanel: ({ field, onChange }) => {
    const { companyId } = useAuth();
    const [uploading, setUploading] = useState(false);
    const set = (patch: Record<string, any>) => onChange({ ...field, config: { ...field.config, ...patch } });
    const handleUpload = async (file: File) => {
      if (!companyId) return;
      setUploading(true);
      try {
        const { url } = await uploadCustomFormAsset(companyId, file);
        set({ url });
      } finally {
        setUploading(false);
      }
    };
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Upload</label>
          <input type="file" accept="image/*" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); }} className="text-xs" />
          {uploading && <span className="text-[10px] text-muted-foreground">Uploading…</span>}
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Or Image URL</label>
          <input type="text" value={field.config.url ?? ""} onChange={(e) => set({ url: e.target.value })} placeholder="https://…" className="glass-input text-sm py-1.5 px-2.5 rounded-md" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Width (px)</label><input type="number" value={field.config.width ?? ""} onChange={(e) => set({ width: e.target.value ? Number(e.target.value) : undefined })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Height (px)</label><input type="number" value={field.config.height ?? ""} onChange={(e) => set({ height: e.target.value ? Number(e.target.value) : undefined })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Alignment</label>
          <select value={field.config.alignment ?? "left"} onChange={(e) => set({ alignment: e.target.value })} className="glass-input text-sm py-1.5 px-2 rounded-md">
            <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={!!field.config.rounded} onChange={(e) => set({ rounded: e.target.checked })} /> Rounded Corners</label>
        <div className="flex flex-col gap-1.5"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Caption</label><input type="text" value={field.config.caption ?? ""} onChange={(e) => set({ caption: e.target.value })} className="glass-input text-sm py-1.5 px-2.5 rounded-md" /></div>
      </div>
    );
  },
  FillInput: ({ field }) =>
    field.config.url ? (
      <figure style={{ textAlign: field.config.alignment || "left" }}>
        <img src={field.config.url} alt="" style={{ width: field.config.width || undefined, height: field.config.height || undefined, borderRadius: field.config.rounded ? 8 : 0 }} className="max-h-52 inline-block" />
        {field.config.caption && <figcaption className="text-xs text-muted-foreground mt-1">{field.config.caption}</figcaption>}
      </figure>
    ) : null,
  isEmptyValue: () => false,
};

export const fileUploadElement: ElementDefinition = {
  type: "fileUpload",
  label: "File Upload",
  icon: Upload,
  category: "basicInputs",
  kind: "field",
  isFileField: true,
  defaultConfig: () => ({ allowedTypes: "", maxSizeMb: 10, maxFiles: 1 }),
  CanvasPreview: () => (
    <div className="w-fit flex items-center gap-2 border border-dashed border-slate-300 rounded-md px-4 py-2.5 text-sm text-slate-400">
      <Upload className="h-3.5 w-3.5" /> Click or drag a file here
    </div>
  ),
  PropertiesPanel: ({ field, onChange }) => {
    const set = (patch: Record<string, any>) => onChange({ ...field, config: { ...field.config, ...patch } });
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Allowed Types (e.g. .pdf,.jpg,.png)</label><input type="text" value={field.config.allowedTypes ?? ""} onChange={(e) => set({ allowedTypes: e.target.value })} className="glass-input text-sm py-1.5 px-2.5 rounded-md" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Max Size (MB)</label><input type="number" value={field.config.maxSizeMb ?? 10} onChange={(e) => set({ maxSizeMb: Number(e.target.value) })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Max Files</label><input type="number" min={1} value={field.config.maxFiles ?? 1} onChange={(e) => set({ maxFiles: Number(e.target.value) })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
        </div>
      </div>
    );
  },
  FillInput: ({ field, value, onChange }) => {
    const multiple = (field.config.maxFiles ?? 1) > 1;
    const files: File[] = Array.isArray(value) ? value : value instanceof File ? [value] : [];
    return (
      <div className="flex flex-col gap-1.5">
        <input
          type="file"
          multiple={multiple}
          accept={field.config.allowedTypes || undefined}
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []).slice(0, field.config.maxFiles ?? 1);
            onChange(multiple ? list : list[0] ?? null);
          }}
          className="text-sm"
        />
        {files.map((f, i) => (
          <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
            {f.type.startsWith("image/") && <img src={URL.createObjectURL(f)} alt="" className="h-8 w-8 object-cover rounded" />}
            {f.name}
          </div>
        ))}
      </div>
    );
  },
  isEmptyValue: defaultEmptyCheck,
};

export const timeElement: ElementDefinition = {
  type: "time",
  label: "Time",
  icon: Clock,
  category: "basicInputs",
  kind: "field",
  defaultConfig: () => ({ format: "24h", minuteInterval: 1 }),
  CanvasPreview: () => <div className="w-fit border border-slate-300 rounded-md px-3 py-1.5 text-sm text-slate-400">--:--</div>,
  PropertiesPanel: ({ field, onChange }) => {
    const set = (patch: Record<string, any>) => onChange({ ...field, config: { ...field.config, ...patch } });
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Format</label>
          <select value={field.config.format ?? "24h"} onChange={(e) => set({ format: e.target.value })} className="glass-input text-sm py-1.5 px-2 rounded-md">
            <option value="24h">24 Hour</option><option value="12h">12 Hour</option>
          </select>
        </div>
        <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Minute Interval</label><input type="number" min={1} max={60} value={field.config.minuteInterval ?? 1} onChange={(e) => set({ minuteInterval: Number(e.target.value) })} className="glass-input text-sm py-1.5 px-2 rounded-md w-24" /></div>
      </div>
    );
  },
  FillInput: ({ field, value, onChange }) => (
    <input type="time" value={value ?? ""} readOnly={field.readonly} step={(field.config.minuteInterval ?? 1) * 60} onChange={(e) => onChange(e.target.value)} className="glass-input text-sm py-2 px-3 rounded-md" />
  ),
  isEmptyValue: defaultEmptyCheck,
};

export const captchaElement: ElementDefinition = {
  type: "captcha",
  label: "Captcha",
  icon: ShieldCheck,
  category: "basicInputs",
  kind: "field",
  defaultConfig: () => ({ provider: "simpleMath" }),
  CanvasPreview: () => <div className="w-fit border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-500">What is 3 + 4? <input disabled className="w-12 border-b border-slate-300 ml-1 bg-transparent" /></div>,
  PropertiesPanel: ({ field, onChange }) => (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Provider</label>
      <select value={field.config.provider ?? "simpleMath"} onChange={(e) => onChange({ ...field, config: { ...field.config, provider: e.target.value } })} className="glass-input text-sm py-1.5 px-2 rounded-md">
        <option value="simpleMath">Simple Math</option>
        <option value="recaptcha" disabled>Google reCAPTCHA — needs a site key</option>
        <option value="turnstile" disabled>Cloudflare Turnstile — needs a site key</option>
      </select>
      <p className="text-[10px] text-muted-foreground mt-1">A fresh math question is generated each time the form loads.</p>
    </div>
  ),
  FillInput: ({ value, onChange }) => {
    const [challenge] = useState(() => ({ a: 1 + Math.floor(Math.random() * 9), b: 1 + Math.floor(Math.random() * 9) }));
    const entered = value?.a === challenge.a && value?.b === challenge.b ? value.answer : "";
    return (
      <div className="flex items-center gap-2 text-sm">
        <span>What is {challenge.a} + {challenge.b}?</span>
        <input
          type="text"
          inputMode="numeric"
          value={entered}
          onChange={(e) => onChange({ a: challenge.a, b: challenge.b, answer: e.target.value })}
          className="glass-input text-sm py-1.5 px-2.5 rounded-md w-16"
        />
      </div>
    );
  },
  isEmptyValue: (value) => !value || Number(value.answer) !== value.a + value.b,
  // A captcha only checked when the field happens to be marked "Required"
  // defeats the point of having one at all — validateValue runs
  // unconditionally (see CustomFormRenderer.tsx's validateFieldValue),
  // unlike isEmptyValue above, which the required-check only reaches when
  // required is actually on. This is what actually stops a wrong (or
  // blank) answer from submitting regardless of that toggle.
  validateValue: (value, field) =>
    !value || Number(value.answer) !== value.a + value.b
      ? field.validation.errorMessage || "Incorrect answer to the security check — please try again."
      : null,
};

export const spinnerElement: ElementDefinition = {
  type: "spinner",
  label: "Spinner",
  icon: ChevronsUpDown,
  category: "basicInputs",
  kind: "field",
  defaultConfig: () => ({ min: 0, max: 100, step: 1, defaultValue: 0 }),
  CanvasPreview: ({ config }) => (
    <div className="w-fit flex items-center border border-slate-300 rounded-md overflow-hidden text-sm text-slate-500">
      <span className="px-3 py-1.5">{config.defaultValue ?? config.min ?? 0}</span>
      <div className="flex flex-col border-l border-slate-300 text-[10px] leading-none">
        <span className="px-1.5 py-0.5 border-b border-slate-300">▲</span>
        <span className="px-1.5 py-0.5">▼</span>
      </div>
    </div>
  ),
  PropertiesPanel: ({ field, onChange }) => (
    <div className="grid grid-cols-2 gap-2">
      {(["min", "max", "step", "defaultValue"] as const).map((k) => (
        <div key={k} className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{k === "defaultValue" ? "Default" : k}</label>
          <input type="number" value={field.config[k] ?? ""} onChange={(e) => onChange({ ...field, config: { ...field.config, [k]: Number(e.target.value) } })} className="glass-input text-sm py-1.5 px-2 rounded-md" />
        </div>
      ))}
    </div>
  ),
  FillInput: ({ field, value, onChange }) => {
    const num = Number(value ?? field.config.defaultValue ?? field.config.min ?? 0);
    const step = field.config.step ?? 1;
    const clamp = (n: number) => Math.min(field.config.max ?? Infinity, Math.max(field.config.min ?? -Infinity, n));
    return (
      <div className="flex items-center border border-white/15 rounded-md overflow-hidden w-fit">
        <input type="number" value={num} readOnly={field.readonly} onChange={(e) => onChange(clamp(Number(e.target.value)))} className="glass-input text-sm py-1.5 px-3 rounded-none border-0 w-20" />
        <div className="flex flex-col border-l border-white/15">
          <button type="button" onClick={() => onChange(clamp(num + step))} className="px-2 text-xs hover:bg-white/10">▲</button>
          <button type="button" onClick={() => onChange(clamp(num - step))} className="px-2 text-xs hover:bg-white/10 border-t border-white/15">▼</button>
        </div>
      </div>
    );
  },
  isEmptyValue: (value) => value === undefined || value === null || value === "",
};

export const submitButtonElement: ElementDefinition = {
  type: "submitButton",
  label: "Submit Button",
  icon: Send,
  category: "basicInputs",
  kind: "structural",
  defaultConfig: () => ({ buttonLabel: "Submit", loadingText: "Submitting…", successMessage: "", redirectUrl: "", style: "solid", fullWidth: false }),
  CanvasPreview: ({ config }) => (
    <button type="button" disabled className={`btn text-sm px-4 py-2 opacity-80 ${config.style === "outline" ? "border border-blue-500 text-blue-400" : "bg-blue-600 text-white"} ${config.fullWidth ? "w-full" : ""}`}>{config.buttonLabel || "Submit"}</button>
  ),
  PropertiesPanel: ({ field, onChange }) => {
    const set = (patch: Record<string, any>) => onChange({ ...field, config: { ...field.config, ...patch } });
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Button Text</label><input type="text" value={field.config.buttonLabel ?? ""} onChange={(e) => set({ buttonLabel: e.target.value })} className="glass-input text-sm py-1.5 px-2.5 rounded-md" /></div>
        <div className="flex flex-col gap-1.5"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Loading Text</label><input type="text" value={field.config.loadingText ?? ""} onChange={(e) => set({ loadingText: e.target.value })} className="glass-input text-sm py-1.5 px-2.5 rounded-md" /></div>
        <div className="flex flex-col gap-1.5"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Success Message</label><input type="text" value={field.config.successMessage ?? ""} onChange={(e) => set({ successMessage: e.target.value })} placeholder="Submitted — thanks!" className="glass-input text-sm py-1.5 px-2.5 rounded-md" /></div>
        <div className="flex flex-col gap-1.5"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Redirect URL (optional)</label><input type="text" value={field.config.redirectUrl ?? ""} onChange={(e) => set({ redirectUrl: e.target.value })} placeholder="https://…" className="glass-input text-sm py-1.5 px-2.5 rounded-md" /></div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Button Style</label>
          <select value={field.config.style ?? "solid"} onChange={(e) => set({ style: e.target.value })} className="glass-input text-sm py-1.5 px-2 rounded-md">
            <option value="solid">Solid</option><option value="outline">Outline</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={!!field.config.fullWidth} onChange={(e) => set({ fullWidth: e.target.checked })} /> Full Width</label>
      </div>
    );
  },
  // Never rendered inline by the generic field loop — CustomFormRenderer
  // special-cases "submitButton" to place the real submit action/button,
  // reading its config. See CustomFormRenderer.tsx.
  FillInput: () => null,
  isEmptyValue: () => false,
};

export const BASIC_INPUTS_ELEMENTS: ElementDefinition[] = [
  shortTextElement,
  longTextElement,
  paragraphElement,
  dropdownElement,
  singleChoiceElement,
  multipleChoiceElement,
  numberElement,
  imageElement,
  fileUploadElement,
  timeElement,
  captchaElement,
  spinnerElement,
  submitButtonElement,
];
