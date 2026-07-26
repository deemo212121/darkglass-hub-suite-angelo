/**
 * The Style-tab controls shared by both CustomFormBuilder.tsx's form-field
 * properties panel and DocumentTemplateEditor.tsx's block properties panel
 * — both a CustomFormField and a DocumentBlock carry the exact same
 * width/displayMode/style triple (see applyFieldStyle in
 * src/lib/formElements/types.ts), so one shared control set edits either.
 */
import type { FieldDisplayMode, FieldStyle, FieldWidth } from "@/lib/formElements";

interface StyleTarget {
  width: FieldWidth;
  displayMode: FieldDisplayMode;
  style: FieldStyle;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

export function StyleFields<T extends StyleTarget>({ target, onChange, hideDisplayMode }: { target: T; onChange: (patch: Partial<T>) => void; hideDisplayMode?: boolean }) {
  const setStyle = (patch: Partial<FieldStyle>) => onChange({ style: { ...target.style, ...patch } } as Partial<T>);

  return (
    <div className="flex flex-col gap-3">
      {!hideDisplayMode && (
        <Field label="Display Mode">
          <div className="flex gap-1.5">
            {(["block", "shrink", "inline"] as const).map((m) => (
              <button key={m} type="button" onClick={() => onChange({ displayMode: m, width: m === "block" ? 100 : target.width } as Partial<T>)} className={`flex-1 text-[10px] px-1.5 py-1.5 rounded border ${target.displayMode === m ? "border-primary/40 bg-primary/10" : "border-white/10 hover:bg-white/5"}`}>
                {m === "block" ? "Full Width" : m === "shrink" ? "Shrink To Content" : "Inline"}
              </button>
            ))}
          </div>
        </Field>
      )}
      <Field label="Width">
        <div className="flex flex-wrap gap-1">
          {([25, 33, 50, 66, 75, 100] as const).map((w) => (
            <button key={w} type="button" onClick={() => onChange({ width: w } as Partial<T>)} className={`text-[10px] px-2 py-1 rounded border ${target.width === w ? "border-primary/40 bg-primary/10" : "border-white/10 hover:bg-white/5"}`}>{w}%</button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Margin (CSS)"><input type="text" value={target.style.margin ?? ""} onChange={(e) => setStyle({ margin: e.target.value })} placeholder="0" className="glass-input text-sm py-1.5 px-2 rounded-md" /></Field>
        <Field label="Padding (CSS)"><input type="text" value={target.style.padding ?? ""} onChange={(e) => setStyle({ padding: e.target.value })} placeholder="0" className="glass-input text-sm py-1.5 px-2 rounded-md" /></Field>
      </div>
      <Field label="Alignment">
        <select value={target.style.alignment ?? "left"} onChange={(e) => setStyle({ alignment: e.target.value as FieldStyle["alignment"] })} className="glass-input text-sm py-1.5 px-2 rounded-md">
          <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Border Radius (px)"><input type="number" value={target.style.borderRadius ?? ""} onChange={(e) => setStyle({ borderRadius: e.target.value ? Number(e.target.value) : undefined })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></Field>
        <Field label="Font Size (px)"><input type="number" value={target.style.fontSize ?? ""} onChange={(e) => setStyle({ fontSize: e.target.value ? Number(e.target.value) : undefined })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></Field>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Background"><input type="color" value={target.style.backgroundColor || "#ffffff"} onChange={(e) => setStyle({ backgroundColor: e.target.value })} className="h-8 w-full" /></Field>
        <Field label="Border"><input type="color" value={target.style.borderColor || "#e2e8f0"} onChange={(e) => setStyle({ borderColor: e.target.value })} className="h-8 w-full" /></Field>
        <Field label="Text"><input type="color" value={target.style.textColor || "#0f172a"} onChange={(e) => setStyle({ textColor: e.target.value })} className="h-8 w-full" /></Field>
      </div>
      <Field label="Font Weight">
        <select value={target.style.fontWeight ?? "normal"} onChange={(e) => setStyle({ fontWeight: e.target.value as FieldStyle["fontWeight"] })} className="glass-input text-sm py-1.5 px-2 rounded-md">
          <option value="normal">Normal</option><option value="bold">Bold</option>
        </select>
      </Field>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!target.style.shadow} onChange={(e) => setStyle({ shadow: e.target.checked })} /> Shadow</label>
      </div>
      <Field label={`Opacity (${target.style.opacity ?? 1})`}>
        <input type="range" min={0} max={1} step={0.05} value={target.style.opacity ?? 1} onChange={(e) => setStyle({ opacity: Number(e.target.value) })} className="w-full" />
      </Field>
    </div>
  );
}
