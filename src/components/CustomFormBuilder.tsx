/**
 * The Form Maker builder: a searchable, categorized element palette on the
 * left, a live read-only preview "page" in the middle, and a 5-tab
 * properties panel on the right for whichever element is selected
 * (General / Style / Validation / Logic / Advanced) — every element's full
 * common property set plus its own type-specific settings are edited
 * there, never inline on the canvas.
 *
 * Every element type comes from ELEMENT_REGISTRY (src/lib/formElements) —
 * this file never switches on `field.type` itself, so a brand new element
 * type just needs to exist in that registry to show up here automatically.
 *
 * Drag-and-drop (both dragging a palette item onto the canvas, and
 * reordering an existing field) is hand-rolled on top of @dnd-kit/core's
 * DndContext WITHOUT its droppable/collision system — that never actually
 * works in this app (its rect-measurement pipeline never populates,
 * confirmed by direct instrumentation), so `over` is always null. Instead,
 * every field row registers its own DOM node in a plain ref map, and drop
 * position is computed by comparing the dragged item's live on-screen
 * center (`active.rect.current.translated`, which DOES track correctly) to
 * each row's measured midpoint.
 */
import { useRef, useState } from "react";
import { DndContext, useDraggable, type DragEndEvent, type DragMoveEvent, type DragStartEvent } from "@dnd-kit/core";
import { GripVertical, Trash2, Loader2, Plus, Search, ChevronDown, ChevronRight, EyeOff, Zap, Sigma } from "lucide-react";
import {
  ELEMENT_REGISTRY, CATEGORIES, validateFormFields, defaultCustomFormField, applyFieldStyle,
  slugifyFieldName, uniqueFieldName,
  type CustomFormField, type ConditionOperator, type FieldCondition,
} from "@/lib/formElements";
import { createCustomForm, updateCustomForm, publishCustomForm, sendDiscordTestMessage, type CustomForm, type CustomFormAccess } from "@/lib/supabase/customForms";
import { DocumentTemplateEditor } from "./DocumentTemplateEditor";
import { normalizeDocumentBlock, type DocumentBlock } from "@/lib/documentTemplates/types";
import { StyleFields } from "./StyleFields";
import { NotifyRecipientsPicker } from "./NotifyRecipientsPicker";

interface Props {
  initial: CustomForm | null;
  onSaved: (form: CustomForm) => void;
  onCancel: () => void;
}

type ActiveData = { kind: "palette"; type: string } | { kind: "field" };

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const copy = arr.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

function PaletteItem({ type, onClick }: { type: string; onClick: () => void }) {
  const def = ELEMENT_REGISTRY[type];
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `palette-${type}`, data: { kind: "palette", type } satisfies ActiveData });
  const Icon = def.icon;
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      type="button"
      style={{ transform: isDragging ? `translate(${transform?.x ?? 0}px, ${transform?.y ?? 0}px)` : undefined, zIndex: isDragging ? 20 : undefined }}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 text-xs font-medium text-left cursor-grab active:cursor-grabbing transition-colors ${isDragging ? "opacity-60" : ""}`}
    >
      <Icon className="h-3.5 w-3.5 text-blue-300 shrink-0" />
      {def.label}
    </button>
  );
}

function Palette({ onAdd }: { onAdd: (type: string) => void }) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const q = search.trim().toLowerCase();

  return (
    <div className="w-56 shrink-0 flex flex-col gap-3 sticky top-4 max-h-[80vh] overflow-y-auto pr-1">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search elements…" className="glass-input text-xs py-1.5 pl-8 pr-2.5 rounded-md w-full" />
      </div>
      {CATEGORIES.map((cat) => {
        const types = q ? cat.types.filter((t) => ELEMENT_REGISTRY[t].label.toLowerCase().includes(q)) : cat.types;
        if (types.length === 0) return null;
        const isOpen = q ? true : !collapsed.has(cat.key);
        return (
          <div key={cat.key} className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setCollapsed((prev) => { const next = new Set(prev); if (next.has(cat.key)) next.delete(cat.key); else next.add(cat.key); return next; })}
              className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide"
            >
              {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} {cat.label}
            </button>
            {isOpen && <div className="flex flex-col gap-1">{types.map((type) => <PaletteItem key={type} type={type} onClick={() => onAdd(type)} />)}</div>}
          </div>
        );
      })}
    </div>
  );
}

function CanvasField({
  field,
  selected,
  rowRef,
  showIndicatorAbove,
  onSelect,
  onDelete,
}: {
  field: CustomFormField;
  selected: boolean;
  rowRef: (el: HTMLDivElement | null) => void;
  showIndicatorAbove: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const def = ELEMENT_REGISTRY[field.type];
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({ id: field.id, data: { kind: "field" } satisfies ActiveData });
  if (!def) return null;

  return (
    <div ref={rowRef} style={applyFieldStyle(field)} className="min-w-0">
      {showIndicatorAbove && <div className="h-0.5 -mt-0.5 mb-1.5 rounded bg-blue-400" />}
      <div
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
        style={{ transform: isDragging ? `translate(${transform?.x ?? 0}px, ${transform?.y ?? 0}px)` : undefined, zIndex: isDragging ? 10 : undefined }}
        className={`group relative py-3 px-3 rounded-md cursor-pointer transition-colors ${selected ? "ring-2 ring-blue-400 bg-blue-50/50" : "hover:bg-slate-50"} ${isDragging ? "opacity-60" : ""} ${field.hidden ? "opacity-50" : ""}`}
      >
        <div className="absolute -left-2 top-3 flex flex-col opacity-30 group-hover:opacity-100 transition-opacity">
          <button ref={setDragRef} {...listeners} {...attributes} type="button" onClick={(e) => e.stopPropagation()} className="text-slate-400 hover:text-slate-700 cursor-grab active:cursor-grabbing" title="Drag to reorder">
            <GripVertical className="h-4 w-4" />
          </button>
        </div>
        <div className="absolute right-2 top-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {field.hidden && <span title="Hidden"><EyeOff className="h-3.5 w-3.5 text-slate-400" /></span>}
          {field.conditionalLogic && <span title="Has conditional logic"><Zap className="h-3.5 w-3.5 text-amber-500" /></span>}
          {field.calculation && <span title="Calculated field"><Sigma className="h-3.5 w-3.5 text-purple-500" /></span>}
          <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete" className="text-slate-400 hover:text-red-500">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {def.kind === "field" && (
          <p className="text-sm font-semibold text-slate-900 mb-1">
            {field.label || <span className="text-slate-400 font-normal italic">Untitled question</span>}
            {field.required && <span className="text-red-500 ml-0.5">*</span>}
          </p>
        )}
        {def.kind === "field" && field.description && <p className="text-xs text-slate-600 mb-1">{field.description}</p>}
        {def.kind === "field" && field.helpText && <p className="text-xs text-slate-500 mb-1.5">{field.helpText}</p>}
        <def.CanvasPreview field={field} config={field.config} />
      </div>
    </div>
  );
}

const TABS = ["General", "Style", "Validation", "Logic", "Advanced"] as const;
type Tab = (typeof TABS)[number];

const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: "equals",
  notEquals: "does not equal",
  contains: "contains",
  greaterThan: "is greater than",
  lessThan: "is less than",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
};

function PropertiesPanel({ field, allFields, onChange, onDelete }: { field: CustomFormField; allFields: CustomFormField[]; onChange: (f: CustomFormField) => void; onDelete: () => void }) {
  const [tab, setTab] = useState<Tab>("General");
  const def = ELEMENT_REGISTRY[field.type];
  const Icon = def.icon;
  const otherNames = allFields.filter((f) => f.id !== field.id).map((f) => f.name);

  const setValidation = (patch: Record<string, any>) => onChange({ ...field, validation: { ...field.validation, ...patch } });
  const setAdvanced = (patch: Record<string, any>) => onChange({ ...field, advanced: { ...field.advanced, ...patch } });
  const setLogic = (patch: Record<string, any>) => onChange({ ...field, conditionalLogic: { action: "show", match: "all", conditions: [], ...field.conditionalLogic, ...patch } });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 pb-2 border-b border-white/10">
        <Icon className="h-4 w-4 text-blue-300" />
        <h3 className="text-sm font-semibold">{def.label}</h3>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-white/10 pb-2">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`text-[11px] px-2 py-1 rounded ${tab === t ? "bg-primary/20 text-primary font-semibold" : "text-muted-foreground hover:bg-white/5"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "General" && (
        <div className="flex flex-col gap-3">
          {def.kind === "field" && (
            <>
              <Field label="Label"><input type="text" value={field.label} onChange={(e) => onChange({ ...field, label: e.target.value })} className="glass-input text-sm py-1.5 px-2.5 rounded-md" /></Field>
              <Field label="Description"><input type="text" value={field.description ?? ""} onChange={(e) => onChange({ ...field, description: e.target.value })} className="glass-input text-sm py-1.5 px-2.5 rounded-md" /></Field>
              <Field label="Placeholder"><input type="text" value={field.placeholder ?? ""} onChange={(e) => onChange({ ...field, placeholder: e.target.value })} className="glass-input text-sm py-1.5 px-2.5 rounded-md" /></Field>
              <Field label="Help Text"><input type="text" value={field.helpText ?? ""} onChange={(e) => onChange({ ...field, helpText: e.target.value })} className="glass-input text-sm py-1.5 px-2.5 rounded-md" /></Field>
              <Field label="Tooltip"><input type="text" value={field.tooltip ?? ""} onChange={(e) => onChange({ ...field, tooltip: e.target.value })} className="glass-input text-sm py-1.5 px-2.5 rounded-md" /></Field>
              <Field label="Unique Field Name">
                <input
                  type="text"
                  value={field.name}
                  onChange={(e) => onChange({ ...field, name: slugifyFieldName(e.target.value, field.name) })}
                  onBlur={(e) => onChange({ ...field, name: uniqueFieldName(slugifyFieldName(e.target.value, field.name), otherNames) })}
                  className="glass-input text-sm py-1.5 px-2.5 rounded-md font-mono"
                />
              </Field>
              <Field label="Default Value"><input type="text" value={field.defaultValue ?? ""} onChange={(e) => onChange({ ...field, defaultValue: e.target.value })} className="glass-input text-sm py-1.5 px-2.5 rounded-md" /></Field>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={field.required} onChange={(e) => onChange({ ...field, required: e.target.checked })} /> Required</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={field.hidden} onChange={(e) => onChange({ ...field, hidden: e.target.checked })} /> Hidden</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={field.readonly} onChange={(e) => onChange({ ...field, readonly: e.target.checked })} /> Read Only</label>
              </div>
              <div className="border-t border-white/10 pt-3" />
            </>
          )}
          <def.PropertiesPanel field={field} allFields={allFields} onChange={onChange} />
        </div>
      )}

      {tab === "Style" && <StyleFields target={field} onChange={(patch) => onChange({ ...field, ...patch })} />}

      {tab === "Validation" && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Min Length"><input type="number" value={field.validation.minLength ?? ""} onChange={(e) => setValidation({ minLength: e.target.value ? Number(e.target.value) : undefined })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></Field>
            <Field label="Max Length"><input type="number" value={field.validation.maxLength ?? ""} onChange={(e) => setValidation({ maxLength: e.target.value ? Number(e.target.value) : undefined })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></Field>
          </div>
          <Field label="Regex"><input type="text" value={field.validation.regex ?? ""} onChange={(e) => setValidation({ regex: e.target.value })} placeholder="^[A-Z].*$" className="glass-input text-sm py-1.5 px-2.5 rounded-md font-mono" /></Field>
          <Field label="Error Message"><input type="text" value={field.validation.errorMessage ?? ""} onChange={(e) => setValidation({ errorMessage: e.target.value })} className="glass-input text-sm py-1.5 px-2.5 rounded-md" /></Field>
          <Field label="Custom Validation Function">
            <textarea value={field.validation.customExpression ?? ""} onChange={(e) => setValidation({ customExpression: e.target.value })} placeholder='value != ""' className="glass-input text-sm py-1.5 px-2.5 rounded-md min-h-16 font-mono" />
            <p className="text-[10px] text-muted-foreground mt-1">Must evaluate to true/false. Supports field names, numbers/strings, + − * / %, == != &gt; &lt; &gt;= &lt;=, &amp;&amp; || !, and (parentheses) — no real code execution.</p>
          </Field>
        </div>
      )}

      {tab === "Logic" && (
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={!!field.conditionalLogic} onChange={(e) => onChange({ ...field, conditionalLogic: e.target.checked ? { action: "show", match: "all", conditions: [] } : null })} /> Enable Conditional Logic
          </label>
          {field.conditionalLogic && (
            <>
              <Field label="Action">
                <select value={field.conditionalLogic.action} onChange={(e) => setLogic({ action: e.target.value })} className="glass-input text-sm py-1.5 px-2 rounded-md">
                  <option value="show">Show If</option><option value="hide">Hide If</option><option value="enable">Enable If</option><option value="disable">Disable If</option>
                </select>
              </Field>
              <Field label="Match">
                <select value={field.conditionalLogic.match} onChange={(e) => setLogic({ match: e.target.value })} className="glass-input text-sm py-1.5 px-2 rounded-md">
                  <option value="all">All conditions</option><option value="any">Any condition</option>
                </select>
              </Field>
              <div className="flex flex-col gap-1.5">
                {field.conditionalLogic.conditions.map((c, i) => {
                  const updateCondition = (patch: Partial<FieldCondition>) => {
                    const conditions = field.conditionalLogic!.conditions.map((cc, idx) => (idx === i ? { ...cc, ...patch } : cc));
                    setLogic({ conditions });
                  };
                  return (
                    <div key={i} className="flex flex-col gap-1 border border-white/10 rounded-md p-2">
                      <select value={c.fieldName} onChange={(e) => updateCondition({ fieldName: e.target.value })} className="glass-input text-xs py-1 px-1.5 rounded-md">
                        <option value="">Field…</option>
                        {otherNames.map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <select value={c.operator} onChange={(e) => updateCondition({ operator: e.target.value as ConditionOperator })} className="glass-input text-xs py-1 px-1.5 rounded-md">
                        {Object.entries(OPERATOR_LABELS).map(([op, l]) => <option key={op} value={op}>{l}</option>)}
                      </select>
                      {c.operator !== "isEmpty" && c.operator !== "isNotEmpty" && (
                        <input type="text" value={c.value ?? ""} onChange={(e) => updateCondition({ value: e.target.value })} className="glass-input text-xs py-1 px-1.5 rounded-md" placeholder="Value" />
                      )}
                      <button type="button" onClick={() => setLogic({ conditions: field.conditionalLogic!.conditions.filter((_, idx) => idx !== i) })} className="text-[10px] text-red-400 hover:text-red-300 self-start">Remove condition</button>
                    </div>
                  );
                })}
                <button type="button" onClick={() => setLogic({ conditions: [...field.conditionalLogic!.conditions, { fieldName: otherNames[0] ?? "", operator: "equals", value: "" }] })} className="text-xs text-blue-400 hover:text-blue-300 self-start">+ Add condition</button>
              </div>
            </>
          )}
          <div className="border-t border-white/10 pt-3" />
          <Field label="Calculation">
            <textarea value={field.calculation ?? ""} onChange={(e) => onChange({ ...field, calculation: e.target.value })} placeholder="price * qty" className="glass-input text-sm py-1.5 px-2.5 rounded-md min-h-14 font-mono" />
            <p className="text-[10px] text-muted-foreground mt-1">When set, this field's value is computed from other fields' Unique Field Names and becomes read-only.</p>
          </Field>
        </div>
      )}

      {tab === "Advanced" && (
        <div className="flex flex-col gap-3">
          <Field label="Field ID"><input type="text" value={field.name} readOnly className="glass-input text-sm py-1.5 px-2.5 rounded-md font-mono opacity-70" /></Field>
          <Field label="CSS Class"><input type="text" value={field.cssClass ?? ""} onChange={(e) => onChange({ ...field, cssClass: e.target.value })} className="glass-input text-sm py-1.5 px-2.5 rounded-md font-mono" /></Field>
          <Field label="Tab Index"><input type="number" value={field.advanced.tabIndex ?? ""} onChange={(e) => setAdvanced({ tabIndex: e.target.value ? Number(e.target.value) : undefined })} className="glass-input text-sm py-1.5 px-2.5 rounded-md w-24" /></Field>
          <Field label="Accessibility Label"><input type="text" value={field.advanced.ariaLabel ?? ""} onChange={(e) => setAdvanced({ ariaLabel: e.target.value })} className="glass-input text-sm py-1.5 px-2.5 rounded-md" /></Field>
          <Field label="Developer Notes"><textarea value={field.advanced.devNotes ?? ""} onChange={(e) => setAdvanced({ devNotes: e.target.value })} className="glass-input text-sm py-1.5 px-2.5 rounded-md min-h-16" /></Field>
          <Field label="Custom Attributes">
            <CustomAttributesEditor attrs={field.advanced.customAttributes ?? {}} onChange={(customAttributes) => setAdvanced({ customAttributes })} />
          </Field>
        </div>
      )}

      <button type="button" onClick={onDelete} className="text-xs text-red-400 hover:text-red-300 self-start flex items-center gap-1 mt-1">
        <Trash2 className="h-3 w-3" /> Delete element
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

function CustomAttributesEditor({ attrs, onChange }: { attrs: Record<string, string>; onChange: (attrs: Record<string, string>) => void }) {
  const entries = Object.entries(attrs);
  const setEntry = (i: number, key: string, value: string) => {
    const next = entries.map((e, idx) => (idx === i ? [key, value] : e)) as [string, string][];
    onChange(Object.fromEntries(next));
  };
  const removeEntry = (i: number) => onChange(Object.fromEntries(entries.filter((_, idx) => idx !== i)));
  return (
    <div className="flex flex-col gap-1.5">
      {entries.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input type="text" value={k} onChange={(e) => setEntry(i, e.target.value, v)} placeholder="attribute" className="glass-input text-xs py-1 px-1.5 rounded-md flex-1 font-mono" />
          <input type="text" value={v} onChange={(e) => setEntry(i, k, e.target.value)} placeholder="value" className="glass-input text-xs py-1 px-1.5 rounded-md flex-1 font-mono" />
          <button type="button" onClick={() => removeEntry(i)} className="text-muted-foreground hover:text-red-400 shrink-0"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ))}
      <button type="button" onClick={() => onChange({ ...attrs, [`data-attr-${entries.length + 1}`]: "" })} className="text-xs text-blue-400 hover:text-blue-300 self-start">+ Add attribute</button>
    </div>
  );
}

export function CustomFormBuilder({ initial, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [access, setAccess] = useState<CustomFormAccess>(initial?.access ?? "internal");
  const [notifyFirebaseUids, setNotifyFirebaseUids] = useState<string[]>(initial?.notifyFirebaseUids ?? []);
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState(initial?.discordWebhookUrl ?? "");
  const [discordTestState, setDiscordTestState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [fields, setFields] = useState<CustomFormField[]>(initial?.fields ?? []);
  const [documentBlocks, setDocumentBlocks] = useState<DocumentBlock[]>((initial?.documentTemplate?.blocks ?? []).map(normalizeDocumentBlock));
  const [activeTab, setActiveTab] = useState<"fields" | "document">("fields");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"draft" | "publish" | null>(null);

  const updateField = (id: string, next: CustomFormField) => setFields((prev) => prev.map((f) => (f.id === id ? next : f)));
  const deleteField = (id: string) => { setFields((prev) => prev.filter((f) => f.id !== id)); setSelectedId((sel) => (sel === id ? null : sel)); };
  const appendField = (type: string) => {
    const def = ELEMENT_REGISTRY[type];
    const f = defaultCustomFormField(type, def, fields.map((x) => x.name));
    setFields((prev) => [...prev, f]);
    setSelectedId(f.id);
  };

  const rowNodes = useRef(new Map<string, HTMLDivElement>());
  const setRowRef = (id: string) => (el: HTMLDivElement | null) => { if (el) rowNodes.current.set(id, el); else rowNodes.current.delete(id); };

  const [isDragging, setIsDragging] = useState(false);
  const [insertBeforeId, setInsertBeforeId] = useState<string | null>(null);

  const computeInsertBeforeId = (centerY: number): string | null => {
    for (const f of fields) {
      const el = rowNodes.current.get(f.id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (centerY < rect.top + rect.height / 2) return f.id;
    }
    return null;
  };

  const handleDragStart = (_event: DragStartEvent) => setIsDragging(true);

  const handleDragMove = (event: DragMoveEvent) => {
    const translated = event.active.rect.current?.translated;
    if (!translated) return;
    setInsertBeforeId(computeInsertBeforeId(translated.top + translated.height / 2));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setIsDragging(false);
    const { active } = event;
    const translated = active.rect.current?.translated;
    if (!translated) return;
    const target = computeInsertBeforeId(translated.top + translated.height / 2);
    const activeData = active.data.current as ActiveData | undefined;

    if (activeData?.kind === "palette") {
      const def = ELEMENT_REGISTRY[activeData.type];
      const created = defaultCustomFormField(activeData.type, def, fields.map((x) => x.name));
      setFields((prev) => {
        if (target === null) return [...prev, created];
        const idx = prev.findIndex((f) => f.id === target);
        return idx === -1 ? [...prev, created] : [...prev.slice(0, idx), created, ...prev.slice(idx)];
      });
      setSelectedId(created.id);
      return;
    }

    setFields((prev) => {
      const from = prev.findIndex((f) => f.id === active.id);
      if (from === -1) return prev;
      let to = target === null ? prev.length - 1 : prev.findIndex((f) => f.id === target);
      if (to === -1) to = prev.length - 1;
      if (to > from) to -= 1;
      if (to === from) return prev;
      return arrayMove(prev, from, to);
    });
  };

  const save = async (publish: boolean) => {
    setError(null);
    if (!title.trim()) { setError("Give the form a title."); return; }
    const fieldsError = validateFormFields(fields);
    if (publish && fieldsError) { setError(fieldsError); return; }

    setSaving(publish ? "publish" : "draft");
    try {
      const input = { title: title.trim(), description: description.trim(), access, fields, documentTemplate: { blocks: documentBlocks }, notifyFirebaseUids, discordWebhookUrl: discordWebhookUrl.trim() || null };
      let form: CustomForm;
      if (initial) {
        form = await updateCustomForm(initial.id, { ...input, currentPublicSlug: initial.publicSlug });
      } else {
        form = await createCustomForm(input);
      }
      if (publish) form = await publishCustomForm(form);
      onSaved(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save form.");
    } finally {
      setSaving(null);
    }
  };

  const handleDiscordTest = async () => {
    if (!discordWebhookUrl.trim()) return;
    setDiscordTestState("sending");
    try {
      await sendDiscordTestMessage(discordWebhookUrl.trim());
      setDiscordTestState("sent");
    } catch {
      setDiscordTestState("error");
    } finally {
      setTimeout(() => setDiscordTestState("idle"), 3000);
    }
  };

  const selectedField = fields.find((f) => f.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Title</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Technician Application" className="glass-input text-sm py-2 px-3 rounded-md" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Who fills this out?</label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAccess("internal")} className={`flex-1 text-left px-3 py-2 rounded-md border text-xs ${access === "internal" ? "border-primary/40 bg-primary/10" : "border-white/10 hover:bg-white/5"}`}>
              <span className="font-medium">Internal</span>
              <p className="text-[10px] text-muted-foreground mt-0.5">Logged-in AHS users only.</p>
            </button>
            <button type="button" onClick={() => setAccess("public")} className={`flex-1 text-left px-3 py-2 rounded-md border text-xs ${access === "public" ? "border-primary/40 bg-primary/10" : "border-white/10 hover:bg-white/5"}`}>
              <span className="font-medium">Public link</span>
              <p className="text-[10px] text-muted-foreground mt-0.5">Anyone with the link, no login.</p>
            </button>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Shown at the top of the form (optional)" className="glass-input text-sm py-2 px-3 rounded-md min-h-14" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Set Notifications</label>
        <NotifyRecipientsPicker value={notifyFirebaseUids} onChange={setNotifyFirebaseUids} />
        <p className="text-[10px] text-muted-foreground">Who gets notified when someone submits this form. Leave blank to notify every HR/Admin/Manager account (the default); pick specific people to notify only them instead.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Discord Notification (optional)</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={discordWebhookUrl}
            onChange={(e) => setDiscordWebhookUrl(e.target.value)}
            placeholder="https://discord.com/api/webhooks/…"
            className="glass-input text-sm py-2 px-3 rounded-md flex-1"
          />
          <button
            type="button"
            onClick={handleDiscordTest}
            disabled={!discordWebhookUrl.trim() || discordTestState === "sending"}
            className="btn text-xs px-3 py-2 shrink-0 disabled:opacity-50 flex items-center gap-1.5"
          >
            {discordTestState === "sending" && <Loader2 className="h-3 w-3 animate-spin" />}
            {discordTestState === "sent" ? "Sent!" : discordTestState === "error" ? "Failed" : "Send Test"}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Every submission posts a message to this channel. Get a URL from Discord: right-click a channel → Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL.
        </p>
      </div>

      <div className="flex gap-1 border-b border-white/10">
        <button type="button" onClick={() => setActiveTab("fields")} className={`text-xs font-semibold px-3 py-2 border-b-2 -mb-px transition-colors ${activeTab === "fields" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          Form Fields
        </button>
        <button type="button" onClick={() => setActiveTab("document")} className={`text-xs font-semibold px-3 py-2 border-b-2 -mb-px transition-colors ${activeTab === "document" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          Document Template{documentBlocks.length > 0 ? ` (${documentBlocks.length})` : ""}
        </button>
      </div>

      {activeTab === "fields" ? (
        <DndContext onDragStart={handleDragStart} onDragMove={handleDragMove} onDragEnd={handleDragEnd} onDragCancel={() => setIsDragging(false)}>
          <div className="flex gap-4 items-start">
            <Palette onAdd={appendField} />

            {/* Represents the actual fill-out page, always on a white background — text must stay dark regardless of the app's own light/dark theme rather than inheriting its (theme-dependent) foreground color. */}
            <div className="flex-1 min-w-0 bg-white rounded-lg shadow-xl p-6" style={{ color: "#111827" }} onClick={() => setSelectedId(null)}>
              <h2 className="text-lg font-bold text-slate-900">{title || "Untitled Form"}</h2>
              {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}

              <div className="mt-4 flex flex-wrap">
                {fields.map((f) => (
                  <CanvasField
                    key={f.id}
                    field={f}
                    selected={selectedId === f.id}
                    rowRef={setRowRef(f.id)}
                    showIndicatorAbove={isDragging && insertBeforeId === f.id}
                    onSelect={() => setSelectedId(f.id)}
                    onDelete={() => deleteField(f.id)}
                  />
                ))}
              </div>

              {isDragging && insertBeforeId === null && fields.length > 0 && <div className="h-0.5 mb-1.5 rounded bg-blue-400" />}

              <div className={`mt-2 rounded-md border-2 border-dashed text-center py-6 text-xs transition-colors ${isDragging ? "border-blue-400 bg-blue-50 text-blue-500" : "border-slate-200 text-slate-400"}`}>
                {fields.length === 0 ? "Drag an element here to get started" : "Drop here to add another element"}
              </div>
            </div>

            <div className="w-72 shrink-0 sticky top-4 panel p-4 max-h-[85vh] overflow-y-auto">
              {selectedField ? (
                <PropertiesPanel field={selectedField} allFields={fields} onChange={(next) => updateField(selectedField.id, next)} onDelete={() => deleteField(selectedField.id)} />
              ) : (
                <p className="text-xs text-muted-foreground">Select an element on the page to edit its properties.</p>
              )}
            </div>
          </div>
        </DndContext>
      ) : (
        <DocumentTemplateEditor blocks={documentBlocks} onChange={setDocumentBlocks} formFields={fields} formTitle={title} />
      )}

      {error && <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-2">{error}</p>}

      <div className="flex items-center gap-2 pt-2 border-t border-white/10">
        <button type="button" onClick={() => save(false)} disabled={saving !== null} className="btn text-sm px-4 py-2 disabled:opacity-50 flex items-center gap-2">
          {saving === "draft" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save Draft
        </button>
        <button type="button" onClick={() => save(true)} disabled={saving !== null} className="btn text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 flex items-center gap-2">
          {saving === "publish" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} <Plus className="h-3.5 w-3.5" /> Publish
        </button>
        <button type="button" onClick={onCancel} disabled={saving !== null} className="btn text-sm px-4 py-2 ml-auto disabled:opacity-50">Cancel</button>
      </div>
    </div>
  );
}
