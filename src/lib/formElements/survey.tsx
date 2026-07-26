/** "Survey" category — Input Table, Star Rating, Scale Rating. */
import { Table2, Star, SlidersHorizontal, Trash2, Plus } from "lucide-react";
import type { ElementDefinition } from "./types";

interface TableColumn { name: string; cellType: "text" | "number" }

export const inputTableElement: ElementDefinition = {
  type: "inputTable",
  label: "Input Table",
  icon: Table2,
  category: "survey",
  kind: "field",
  defaultConfig: (): { columns: TableColumn[]; rows: number; showTotals: boolean } => ({ columns: [{ name: "Column 1", cellType: "text" }, { name: "Column 2", cellType: "text" }], rows: 3, showTotals: false }),
  CanvasPreview: ({ config }) => {
    const columns: TableColumn[] = config.columns ?? [];
    const rows: number = config.rows ?? 3;
    return (
      <table className="text-sm border border-slate-200 w-full max-w-md">
        <thead><tr>{columns.map((c, i) => <th key={i} className="border border-slate-200 px-2 py-1 text-left font-medium text-slate-600">{c.name}</th>)}</tr></thead>
        <tbody>{Array.from({ length: Math.min(rows, 3) }, (_, r) => <tr key={r}>{columns.map((_, c) => <td key={c} className="border border-slate-200 px-2 py-1 text-slate-300">·</td>)}</tr>)}</tbody>
      </table>
    );
  },
  PropertiesPanel: ({ field, onChange }) => {
    const columns: TableColumn[] = field.config.columns ?? [];
    const setColumns = (next: TableColumn[]) => onChange({ ...field, config: { ...field.config, columns: next } });
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Columns</label>
          {columns.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input type="text" value={c.name} onChange={(e) => setColumns(columns.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))} className="glass-input text-xs py-1.5 px-2 rounded-md flex-1" />
              <select value={c.cellType} onChange={(e) => setColumns(columns.map((x, idx) => (idx === i ? { ...x, cellType: e.target.value as "text" | "number" } : x)))} className="glass-input text-xs py-1.5 px-1.5 rounded-md">
                <option value="text">Text</option><option value="number">Number</option>
              </select>
              <button type="button" onClick={() => setColumns(columns.filter((_, idx) => idx !== i))} disabled={columns.length <= 1} className="text-muted-foreground hover:text-red-400 disabled:opacity-30 shrink-0">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setColumns([...columns, { name: `Column ${columns.length + 1}`, cellType: "text" }])} className="text-xs text-blue-400 hover:text-blue-300 self-start flex items-center gap-1">
            <Plus className="h-3 w-3" /> Add column
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Rows</label>
          <input type="number" min={1} value={field.config.rows ?? 3} onChange={(e) => onChange({ ...field, config: { ...field.config, rows: Number(e.target.value) } })} className="glass-input text-sm py-1.5 px-2.5 rounded-md w-20" />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={!!field.config.showTotals} onChange={(e) => onChange({ ...field, config: { ...field.config, showTotals: e.target.checked } })} /> Show Totals Row (sums Number columns)
        </label>
      </div>
    );
  },
  FillInput: ({ field, value, onChange }) => {
    const columns: TableColumn[] = field.config.columns ?? [];
    const rows: number = field.config.rows ?? 3;
    const grid: string[][] = value ?? Array.from({ length: rows }, () => Array(columns.length).fill(""));
    const setCell = (r: number, c: number, v: string) => {
      const next = grid.map((row) => [...row]);
      next[r] = next[r] ?? [];
      next[r][c] = v;
      onChange(next);
    };
    const totals = columns.map((col, c) => (col.cellType === "number" ? grid.reduce((sum, row) => sum + (Number(row?.[c]) || 0), 0) : null));
    return (
      <table className="text-sm border border-white/15 w-full">
        <thead><tr>{columns.map((c, i) => <th key={i} className="border border-white/15 px-2 py-1 text-left font-medium">{c.name}</th>)}</tr></thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {columns.map((col, c) => (
                <td key={c} className="border border-white/15 p-0.5">
                  <input type={col.cellType === "number" ? "number" : "text"} value={grid[r]?.[c] ?? ""} onChange={(e) => setCell(r, c, e.target.value)} className="glass-input text-sm py-1 px-1.5 rounded-md w-full border-0" />
                </td>
              ))}
            </tr>
          ))}
          {field.config.showTotals && (
            <tr className="font-semibold">
              {columns.map((_, c) => <td key={c} className="border border-white/15 px-2 py-1">{totals[c] != null ? totals[c] : ""}</td>)}
            </tr>
          )}
        </tbody>
      </table>
    );
  },
  isEmptyValue: (value) => !Array.isArray(value) || value.every((row) => row.every((cell: string) => !cell?.trim())),
};

export const starRatingElement: ElementDefinition = {
  type: "starRating",
  label: "Star Rating",
  icon: Star,
  category: "survey",
  kind: "field",
  defaultConfig: () => ({ max: 5, allowHalf: false, color: "#facc15" }),
  CanvasPreview: ({ config }) => (
    <div className="flex gap-1">{Array.from({ length: config.max ?? 5 }, (_, i) => <Star key={i} className="h-5 w-5 text-slate-300" />)}</div>
  ),
  PropertiesPanel: ({ field, onChange }) => {
    const set = (patch: Record<string, any>) => onChange({ ...field, config: { ...field.config, ...patch } });
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Max stars</label><input type="number" min={2} max={10} value={field.config.max ?? 5} onChange={(e) => set({ max: Number(e.target.value) })} className="glass-input text-sm py-1.5 px-2.5 rounded-md w-20" /></div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={!!field.config.allowHalf} onChange={(e) => set({ allowHalf: e.target.checked })} /> Allow Half Stars</label>
        <div className="flex flex-col gap-1.5"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Color</label><input type="color" value={field.config.color ?? "#facc15"} onChange={(e) => set({ color: e.target.value })} className="h-8 w-16" /></div>
      </div>
    );
  },
  FillInput: ({ field, value, onChange }) => {
    const max: number = field.config.max ?? 5;
    const selected: number = value ?? 0;
    const color = field.config.color || "#facc15";
    if (field.config.allowHalf) {
      return (
        <div className="flex gap-1">
          {Array.from({ length: max }, (_, i) => {
            const full = i + 1 <= selected;
            const half = !full && i + 0.5 <= selected;
            return (
              <span key={i} className="relative inline-block h-6 w-6">
                <Star className="h-6 w-6 absolute inset-0 text-slate-500" />
                {(full || half) && <Star className="h-6 w-6 absolute inset-0" style={{ color, fill: color, clipPath: half ? "inset(0 50% 0 0)" : undefined }} />}
                <button type="button" className="absolute inset-0 w-1/2" onClick={() => onChange(i + 0.5)} />
                <button type="button" className="absolute inset-0 left-1/2 w-1/2" onClick={() => onChange(i + 1)} />
              </span>
            );
          })}
        </div>
      );
    }
    return (
      <div className="flex gap-1">
        {Array.from({ length: max }, (_, i) => (
          <button key={i} type="button" onClick={() => onChange(i + 1)}>
            <Star className="h-6 w-6" style={i < selected ? { color, fill: color } : { color: "#64748b" }} />
          </button>
        ))}
      </div>
    );
  },
  isEmptyValue: (value) => !value,
};

const EMOJI_SCALE = ["😞", "🙁", "😐", "🙂", "😀"];

export const scaleRatingElement: ElementDefinition = {
  type: "scaleRating",
  label: "Scale Rating",
  icon: SlidersHorizontal,
  category: "survey",
  kind: "field",
  defaultConfig: () => ({ min: 1, max: 10, minLabel: "Not likely", maxLabel: "Very likely", emojiStyle: false }),
  CanvasPreview: ({ config }) => {
    const min: number = config.min ?? 1;
    const max: number = config.max ?? 10;
    return (
      <div>
        <div className="flex gap-1">{Array.from({ length: max - min + 1 }, (_, i) => <div key={i} className="h-7 w-7 rounded border border-slate-300 flex items-center justify-center text-xs text-slate-400">{config.emojiStyle ? EMOJI_SCALE[Math.min(EMOJI_SCALE.length - 1, Math.floor((i / Math.max(1, max - min)) * EMOJI_SCALE.length))] : min + i}</div>)}</div>
        <div className="flex justify-between text-[10px] text-slate-400 mt-1"><span>{config.minLabel}</span><span>{config.maxLabel}</span></div>
      </div>
    );
  },
  PropertiesPanel: ({ field, onChange }) => {
    const set = (patch: Record<string, any>) => onChange({ ...field, config: { ...field.config, ...patch } });
    return (
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Min</label><input type="number" value={field.config.min ?? 1} onChange={(e) => set({ min: Number(e.target.value) })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Max</label><input type="number" value={field.config.max ?? 10} onChange={(e) => set({ max: Number(e.target.value) })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
        </div>
        <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Min label</label><input type="text" value={field.config.minLabel ?? ""} onChange={(e) => set({ minLabel: e.target.value })} className="glass-input text-sm py-1.5 px-2.5 rounded-md" /></div>
        <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Max label</label><input type="text" value={field.config.maxLabel ?? ""} onChange={(e) => set({ maxLabel: e.target.value })} className="glass-input text-sm py-1.5 px-2.5 rounded-md" /></div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={!!field.config.emojiStyle} onChange={(e) => set({ emojiStyle: e.target.checked })} /> Emoji Style</label>
      </div>
    );
  },
  FillInput: ({ field, value, onChange }) => {
    const min: number = field.config.min ?? 1;
    const max: number = field.config.max ?? 10;
    return (
      <div>
        <div className="flex gap-1 flex-wrap">
          {Array.from({ length: max - min + 1 }, (_, i) => {
            const n = min + i;
            const label = field.config.emojiStyle ? EMOJI_SCALE[Math.min(EMOJI_SCALE.length - 1, Math.floor((i / Math.max(1, max - min)) * EMOJI_SCALE.length))] : n;
            return (
              <button key={n} type="button" onClick={() => onChange(n)} className={`h-9 w-9 rounded border text-sm ${value === n ? "bg-blue-600 border-blue-600 text-white" : "border-white/15 hover:bg-white/10"}`}>
                {label}
              </button>
            );
          })}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1"><span>{field.config.minLabel}</span><span>{field.config.maxLabel}</span></div>
      </div>
    );
  },
  isEmptyValue: (value) => value === undefined || value === null,
};

export const SURVEY_ELEMENTS: ElementDefinition[] = [inputTableElement, starRatingElement, scaleRatingElement];
