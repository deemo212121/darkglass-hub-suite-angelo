/**
 * "Page" category — Divider, Section Collapse, Page Break. The latter two
 * are pure structural markers: CustomFormRenderer.tsx reads them directly
 * (groupFieldsIntoPages) to build collapsible sections and wizard pages
 * rather than rendering them inline via FillInput, which is why their
 * FillInput just returns null.
 */
import { Minus, ChevronDown, SeparatorHorizontal } from "lucide-react";
import type { ElementDefinition } from "./types";
import { makeDisplayElement } from "./factories";

export const dividerElement = makeDisplayElement({ type: "divider", label: "Divider", icon: Minus, category: "page", variant: "divider" });

export const sectionCollapseElement: ElementDefinition = {
  type: "sectionCollapse",
  label: "Section Collapse",
  icon: ChevronDown,
  category: "page",
  kind: "structural",
  defaultConfig: () => ({ title: "Section", defaultOpen: true }),
  CanvasPreview: ({ config }) => (
    <div className="flex items-center gap-1.5 bg-slate-100 rounded-md px-3 py-2 text-sm font-medium text-slate-600">
      <ChevronDown className="h-3.5 w-3.5" /> {config.title || "Section"} <span className="text-xs text-slate-400 font-normal ml-1">— collapsible section starts here{config.defaultOpen === false ? " (closed by default)" : ""}</span>
    </div>
  ),
  PropertiesPanel: ({ field, onChange }) => (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Section Title</label>
        <input type="text" value={field.config.title ?? ""} onChange={(e) => onChange({ ...field, config: { ...field.config, title: e.target.value } })} className="glass-input text-sm py-1.5 px-2.5 rounded-md" />
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={field.config.defaultOpen !== false} onChange={(e) => onChange({ ...field, config: { ...field.config, defaultOpen: e.target.checked } })} /> Default Open
      </label>
    </div>
  ),
  FillInput: () => null,
  isEmptyValue: () => false,
};

export const pageBreakElement: ElementDefinition = {
  type: "pageBreak",
  label: "Page Break",
  icon: SeparatorHorizontal,
  category: "page",
  kind: "structural",
  defaultConfig: () => ({ title: "", nextButtonText: "Next", previousButtonText: "Back", showProgressBar: false }),
  CanvasPreview: ({ config }) => (
    <div className="flex items-center gap-2 my-1">
      <div className="flex-1 border-t-2 border-dashed border-amber-300" />
      <span className="text-xs font-semibold text-amber-500 uppercase tracking-wide">Page Break{config.title ? `: ${config.title}` : ""}</span>
      <div className="flex-1 border-t-2 border-dashed border-amber-300" />
    </div>
  ),
  PropertiesPanel: ({ field, onChange }) => {
    const set = (patch: Record<string, any>) => onChange({ ...field, config: { ...field.config, ...patch } });
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Step label (optional)</label><input type="text" value={field.config.title ?? ""} onChange={(e) => set({ title: e.target.value })} className="glass-input text-sm py-1.5 px-2.5 rounded-md" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Next Button Text</label><input type="text" value={field.config.nextButtonText ?? "Next"} onChange={(e) => set({ nextButtonText: e.target.value })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Previous Button Text</label><input type="text" value={field.config.previousButtonText ?? "Back"} onChange={(e) => set({ previousButtonText: e.target.value })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={!!field.config.showProgressBar} onChange={(e) => set({ showProgressBar: e.target.checked })} /> Show Progress Bar
        </label>
      </div>
    );
  },
  FillInput: () => null,
  isEmptyValue: () => false,
};

export const PAGE_ELEMENTS: ElementDefinition[] = [dividerElement, sectionCollapseElement, pageBreakElement];
