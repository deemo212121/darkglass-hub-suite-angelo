/**
 * Small factory functions that build a full ElementDefinition for element
 * types that only ever differ by a couple of parameters — collapses what
 * would otherwise be ~10 nearly-identical files into three factories. Each
 * call site in basicInputs.tsx/basic.tsx still registers its own distinct
 * `type` key, so the registry (and the "add a new element" story) doesn't
 * change shape at all.
 *
 * Placeholder/Label/Required/etc. are shared properties edited in the
 * builder's General tab (see CustomFormBuilder.tsx) — these factories'
 * PropertiesPanel only needs to cover genuinely type-specific settings.
 */
import { Trash2 } from "lucide-react";
import type { ComponentType } from "react";
import { defaultEmptyCheck, type ElementDefinition, type ElementCategory } from "./types";

/** Shared editable options list — used by makeOptionsElement's PropertiesPanel and Product List/Input Table. */
export function OptionsListEditor({ options, onChange }: { options: string[]; onChange: (options: string[]) => void }) {
  const setOption = (i: number, value: string) => { const next = [...options]; next[i] = value; onChange(next); };
  const addOption = () => onChange([...options, `Option ${options.length + 1}`]);
  const removeOption = (i: number) => onChange(options.filter((_, idx) => idx !== i));

  return (
    <div className="flex flex-col gap-1.5">
      {options.map((o, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input type="text" value={o} onChange={(e) => setOption(i, e.target.value)} className="glass-input text-xs py-1.5 px-2.5 rounded-md flex-1" />
          <button type="button" onClick={() => removeOption(i)} disabled={options.length <= 2} className="text-muted-foreground hover:text-red-400 disabled:opacity-30 shrink-0">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button type="button" onClick={addOption} className="text-xs text-blue-400 hover:text-blue-300 self-start">+ Add option</button>
    </div>
  );
}

export function makeSimpleInputElement(opts: {
  type: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  htmlType: "text" | "email" | "tel" | "number" | "time" | "date";
  category: ElementCategory;
}): ElementDefinition {
  return {
    type: opts.type,
    label: opts.label,
    icon: opts.icon,
    category: opts.category,
    kind: "field",
    defaultConfig: () => ({}),
    CanvasPreview: ({ field }) => (
      <input type={opts.htmlType} disabled placeholder={field.placeholder || "Your answer"} className="w-full max-w-sm text-sm border-0 border-b border-slate-300 bg-transparent py-1 text-slate-400" />
    ),
    PropertiesPanel: () => null,
    FillInput: ({ field, value, onChange }) => (
      <input
        type={opts.htmlType}
        value={value ?? ""}
        readOnly={field.readonly}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        className="glass-input text-sm py-2 px-3 rounded-md w-full"
      />
    ),
    isEmptyValue: defaultEmptyCheck,
  };
}

export function makeOptionsElement(opts: {
  type: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  mode: "select" | "radio" | "checkboxes";
  category: ElementCategory;
}): ElementDefinition {
  return {
    type: opts.type,
    label: opts.label,
    icon: opts.icon,
    category: opts.category,
    kind: "field",
    defaultConfig: () => ({ options: ["Option 1", "Option 2"], allowSearch: false, sortAlphabetically: false, horizontal: false, randomize: false }),
    CanvasPreview: ({ config }) => {
      const options: string[] = config.sortAlphabetically ? [...(config.options ?? [])].sort() : config.options ?? [];
      if (opts.mode === "select") {
        return (
          <div className="w-fit min-w-[160px] flex items-center justify-between gap-2 border border-slate-300 rounded-md px-3 py-1.5 text-sm text-slate-500">
            <span>{options[0] || "Option 1"}</span><span>▾</span>
          </div>
        );
      }
      return (
        <div className={config.horizontal ? "flex flex-wrap gap-3" : "flex flex-col gap-1"}>
          {options.map((o, i) => (
            <label key={i} className="flex items-center gap-2 text-sm text-slate-600">
              <input type={opts.mode === "radio" ? "radio" : "checkbox"} disabled /> {o}
            </label>
          ))}
        </div>
      );
    },
    PropertiesPanel: ({ field, onChange }) => (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Options</label>
          <OptionsListEditor options={field.config.options ?? []} onChange={(options) => onChange({ ...field, config: { ...field.config, options } })} />
        </div>
        {opts.mode === "select" && (
          <>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={!!field.config.allowSearch} onChange={(e) => onChange({ ...field, config: { ...field.config, allowSearch: e.target.checked } })} /> Allow Search
            </label>
          </>
        )}
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={!!field.config.sortAlphabetically} onChange={(e) => onChange({ ...field, config: { ...field.config, sortAlphabetically: e.target.checked } })} /> Alphabetical Sort
        </label>
        {opts.mode !== "select" && (
          <>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={!!field.config.horizontal} onChange={(e) => onChange({ ...field, config: { ...field.config, horizontal: e.target.checked } })} /> Horizontal Layout
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={!!field.config.randomize} onChange={(e) => onChange({ ...field, config: { ...field.config, randomize: e.target.checked } })} /> Randomize Order
            </label>
          </>
        )}
        {opts.mode === "checkboxes" && (
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Min Selection</label>
              <input type="number" value={field.config.minSelection ?? ""} onChange={(e) => onChange({ ...field, config: { ...field.config, minSelection: e.target.value ? Number(e.target.value) : undefined } })} className="glass-input text-sm py-1.5 px-2 rounded-md" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Max Selection</label>
              <input type="number" value={field.config.maxSelection ?? ""} onChange={(e) => onChange({ ...field, config: { ...field.config, maxSelection: e.target.value ? Number(e.target.value) : undefined } })} className="glass-input text-sm py-1.5 px-2 rounded-md" />
            </div>
          </div>
        )}
      </div>
    ),
    FillInput: ({ field, value, onChange }) => {
      const raw: string[] = field.config.options ?? [];
      const options = field.config.sortAlphabetically ? [...raw].sort() : field.config.randomize && !opts.mode.match("select") ? raw : raw;
      if (opts.mode === "select") {
        return (
          <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={field.readonly} className="glass-input text-sm py-2 px-3 rounded-md w-full">
            <option value="">Select…</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      }
      if (opts.mode === "radio") {
        return (
          <div className={field.config.horizontal ? "flex flex-wrap gap-4" : "flex flex-col gap-1.5"}>
            {options.map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm">
                <input type="radio" name={field.id} disabled={field.readonly} checked={value === o} onChange={() => onChange(o)} /> {o}
              </label>
            ))}
          </div>
        );
      }
      const selected: string[] = Array.isArray(value) ? value : [];
      const toggle = (o: string) => onChange(selected.includes(o) ? selected.filter((v) => v !== o) : [...selected, o]);
      return (
        <div className={field.config.horizontal ? "flex flex-wrap gap-4" : "flex flex-col gap-1.5"}>
          {options.map((o) => (
            <label key={o} className="flex items-center gap-2 text-sm">
              <input type="checkbox" disabled={field.readonly} checked={selected.includes(o)} onChange={() => toggle(o)} /> {o}
            </label>
          ))}
        </div>
      );
    },
    isEmptyValue: (value) => (opts.mode === "checkboxes" ? !Array.isArray(value) || value.length === 0 : defaultEmptyCheck(value)),
  };
}

export function makeDisplayElement(opts: {
  type: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  category: ElementCategory;
  variant: "heading" | "paragraph" | "divider";
  defaultText?: string;
}): ElementDefinition {
  const render = (config: Record<string, any>) => {
    if (opts.variant === "divider") {
      return <hr style={{ borderTopStyle: config.lineStyle || "solid", borderTopWidth: `${config.thickness ?? 1}px`, borderTopColor: config.color || "#e2e8f0", margin: `${config.spacing ?? 8}px 0` }} />;
    }
    const textStyle = { textAlign: config.alignment || "left", color: config.color || undefined, fontSize: config.fontSize ? `${config.fontSize}px` : undefined } as React.CSSProperties;
    if (opts.variant === "heading") {
      const Tag = (`h${config.level || 3}` as unknown) as "h1";
      const boldCls = config.bold === false ? "font-normal" : "font-bold";
      const italicCls = config.italic ? "italic" : "";
      const underlineCls = config.underline ? "underline" : "";
      return <Tag style={textStyle} className={`text-slate-900 ${boldCls} ${italicCls} ${underlineCls}`}>{config.text || "Heading"}</Tag>;
    }
    return <p style={{ ...textStyle, marginTop: config.spacing ? `${config.spacing}px` : undefined }} className="text-slate-500">{config.text || "Paragraph text"}</p>;
  };
  return {
    type: opts.type,
    label: opts.label,
    icon: opts.icon,
    category: opts.category,
    kind: "structural",
    defaultConfig: () => (opts.variant === "divider" ? { lineStyle: "solid", thickness: 1, color: "#e2e8f0", spacing: 8 } : { text: opts.defaultText ?? "", alignment: "left", level: 3, bold: true }),
    CanvasPreview: ({ config }) => render(config),
    PropertiesPanel: ({ field, onChange }) => {
      const set = (patch: Record<string, any>) => onChange({ ...field, config: { ...field.config, ...patch } });
      if (opts.variant === "divider") {
        return (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Line Style</label>
              <select value={field.config.lineStyle ?? "solid"} onChange={(e) => set({ lineStyle: e.target.value })} className="glass-input text-sm py-1.5 px-2 rounded-md">
                <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Thickness</label><input type="number" min={1} value={field.config.thickness ?? 1} onChange={(e) => set({ thickness: Number(e.target.value) })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
              <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Spacing</label><input type="number" min={0} value={field.config.spacing ?? 8} onChange={(e) => set({ spacing: Number(e.target.value) })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
            </div>
            <div className="flex flex-col gap-1.5"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Color</label><input type="color" value={field.config.color ?? "#e2e8f0"} onChange={(e) => set({ color: e.target.value })} className="h-8 w-16" /></div>
          </div>
        );
      }
      return (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Text</label>
            {opts.variant === "heading" ? (
              <input type="text" value={field.config.text ?? ""} onChange={(e) => set({ text: e.target.value })} className="glass-input text-sm py-1.5 px-2.5 rounded-md" />
            ) : (
              <textarea value={field.config.text ?? ""} onChange={(e) => set({ text: e.target.value })} className="glass-input text-sm py-1.5 px-2.5 rounded-md min-h-16" />
            )}
          </div>
          {opts.variant === "heading" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Heading Level</label>
              <select value={field.config.level ?? 3} onChange={(e) => set({ level: Number(e.target.value) })} className="glass-input text-sm py-1.5 px-2 rounded-md">
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>H{n}</option>)}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Alignment</label>
            <select value={field.config.alignment ?? "left"} onChange={(e) => set({ alignment: e.target.value })} className="glass-input text-sm py-1.5 px-2 rounded-md">
              <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Color</label><input type="color" value={field.config.color ?? "#0f172a"} onChange={(e) => set({ color: e.target.value })} className="h-8 w-16" /></div>
            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Font Size</label><input type="number" value={field.config.fontSize ?? ""} onChange={(e) => set({ fontSize: e.target.value ? Number(e.target.value) : undefined })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
          </div>
          {opts.variant === "heading" && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={field.config.bold !== false} onChange={(e) => set({ bold: e.target.checked })} /> Bold</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!field.config.italic} onChange={(e) => set({ italic: e.target.checked })} /> Italic</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!field.config.underline} onChange={(e) => set({ underline: e.target.checked })} /> Underline</label>
            </div>
          )}
          {opts.variant === "paragraph" && (
            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Spacing (top margin, px)</label><input type="number" value={field.config.spacing ?? ""} onChange={(e) => set({ spacing: e.target.value ? Number(e.target.value) : undefined })} className="glass-input text-sm py-1.5 px-2 rounded-md w-24" /></div>
          )}
        </div>
      );
    },
    FillInput: ({ field }) => render(field.config),
    isEmptyValue: () => false,
  };
}
