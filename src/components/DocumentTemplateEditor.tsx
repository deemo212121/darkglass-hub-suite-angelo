/**
 * "Turn submissions into documents" — a drag-and-drop PDF template
 * designer, shown as a tab inside CustomFormBuilder.tsx's "Edit Form"
 * screen (alongside the "Form Fields" tab) so building a form and
 * designing how its submissions become PDFs happen in one place, saved
 * together. Purely presentational — the parent owns `blocks` state and
 * persists it (bundled with the form's fields) on Save Draft/Publish.
 *
 * Structurally the same pattern as CustomFormBuilder.tsx (palette →
 * canvas → properties) but simpler: blocks aren't as deep as form fields,
 * so one lightweight panel instead of 5 tabs.
 *
 * Drag-and-drop reuses the exact geometry-based approach proven this
 * session for the form builder: @dnd-kit/core's useDraggable only — its
 * useDroppable/collision system doesn't work in this app (confirmed by
 * direct instrumentation: registered droppables' rects never measure) — so
 * drop position is computed by comparing the dragged item's live on-screen
 * center (`active.rect.current.translated`) to each block row's own
 * measured DOM ref, never `over`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { DndContext, useDraggable, type DragEndEvent, type DragMoveEvent, type DragStartEvent } from "@dnd-kit/core";
import { GripVertical, Trash2, Heading as HeadingIcon, Pilcrow, Image as ImageIcon, FileText, Minus, MoveVertical, Plus, Calendar } from "lucide-react";
import {
  BLOCK_TYPE_LABELS, defaultBlockFor, defaultDateBlock, defaultLogoBlock, fieldValueBlockFor, formatDocumentDate, pinnedBlockStyle,
  PAGE_CONTENT_HEIGHT, PAGE_CONTENT_WIDTH, PAGE_HEIGHT, PAGE_PADDING, PAGE_WIDTH,
  type DocumentBlock, type DocumentBlockType,
} from "@/lib/documentTemplates/types";
import { ELEMENT_REGISTRY, applyFieldStyle, type CustomFormField } from "@/lib/formElements";
import { parseBlankTemplate } from "@/lib/formElements/basic";
import { uploadCustomFormAsset } from "@/lib/firebase/storage";
import { useAuth } from "@/lib/auth";
import { StyleFields } from "./StyleFields";

interface Props {
  blocks: DocumentBlock[];
  onChange: (blocks: DocumentBlock[]) => void;
  formFields: CustomFormField[];
  formTitle: string;
}

type ActiveData = { kind: "palette"; type: DocumentBlockType } | { kind: "block" } | { kind: "pinned" };

const PALETTE: { type: DocumentBlockType; icon: typeof HeadingIcon }[] = [
  { type: "heading", icon: HeadingIcon },
  { type: "paragraph", icon: Pilcrow },
  { type: "image", icon: ImageIcon },
  { type: "fieldValue", icon: FileText },
  { type: "divider", icon: Minus },
  { type: "spacer", icon: MoveVertical },
];

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const copy = arr.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

function PaletteItem({ type, icon: Icon, onClick }: { type: DocumentBlockType; icon: typeof HeadingIcon; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `palette-${type}`, data: { kind: "palette", type } satisfies ActiveData });
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
      {BLOCK_TYPE_LABELS[type]}
    </button>
  );
}

/**
 * A paragraph's raw {{fieldName}} tokens show verbatim at design time for
 * every field type except Fill in the Blank — that field's own "value" is
 * itself a sentence-with-blanks, so showing its own template (with visible
 * blanks) here gives a far more useful preview than the literal token text.
 * Still just a preview: the actual PDF substitutes the real submitted
 * answers, same as any other field (see generate.ts's formatFieldValue).
 */
function renderParagraphPreview(text: string, fillInTheBlankTemplate: (name: string) => string | null) {
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  return parts.map((part, i) => {
    const m = /^\{\{([^}]+)\}\}$/.exec(part);
    if (!m) return <span key={i}>{part}</span>;
    const template = fillInTheBlankTemplate(m[1]);
    if (template == null) return <span key={i} className="italic opacity-60">{part}</span>;
    return (
      <span key={i}>
        {parseBlankTemplate(template).map((seg, j) =>
          seg === null ? <span key={j} className="inline-block w-16 border-b border-current opacity-60 mx-0.5" /> : <span key={j}>{seg}</span>
        )}
      </span>
    );
  });
}

/**
 * Renders plain, unstyled content — text-align/font-size/font-weight/color
 * come from the block's own Style tab and are set once, on BlockRow's outer
 * wrapper (via applyFieldStyle), then inherited here. Mirrors generate.ts's
 * renderBlockContent(), which does the same for the actual PDF output, so
 * the builder preview matches what gets produced.
 */
function BlockPreview({ block, fieldLabel, fillInTheBlankTemplate }: { block: DocumentBlock; fieldLabel: (name: string) => string; fillInTheBlankTemplate: (name: string) => string | null }) {
  if (block.type === "heading") return <h2>{block.text || "Heading"}</h2>;
  if (block.type === "paragraph") return <p className="whitespace-pre-wrap">{renderParagraphPreview(block.text || "Paragraph text", fillInTheBlankTemplate)}</p>;
  if (block.type === "image") return block.imageUrl ? <img src={block.imageUrl} alt="" className="max-h-32" /> : <div className="w-full h-16 rounded-md border border-dashed border-slate-300 flex items-center justify-center text-xs text-slate-400">No image set</div>;
  if (block.type === "fieldValue") {
    if (!block.fieldName) return <p className="text-sm italic opacity-60">Choose a field →</p>;
    return (
      <p>
        {block.showLabel !== false && <strong>{fieldLabel(block.fieldName)}: </strong>}
        <span className="italic opacity-60">{`{{${block.fieldName}}}`}</span>
      </p>
    );
  }
  if (block.type === "divider") return <hr className="border-t border-slate-200" />;
  if (block.type === "date") return <p>{formatDocumentDate(new Date())}</p>;
  return <div className="h-6" />;
}

function BlockRow({
  block, selected, rowRef, showIndicatorAbove, fieldLabel, fillInTheBlankTemplate, onSelect, onDelete,
}: {
  block: DocumentBlock;
  selected: boolean;
  rowRef: (el: HTMLDivElement | null) => void;
  showIndicatorAbove: boolean;
  fieldLabel: (name: string) => string;
  fillInTheBlankTemplate: (name: string) => string | null;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({ id: block.id, data: { kind: "block" } satisfies ActiveData });
  return (
    <div ref={rowRef} style={applyFieldStyle(block)} className="min-w-0">
      {showIndicatorAbove && <div className="h-0.5 -mt-0.5 mb-1.5 rounded bg-blue-400" />}
      <div
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
        style={{ transform: isDragging ? `translate(${transform?.x ?? 0}px, ${transform?.y ?? 0}px)` : undefined, zIndex: isDragging ? 10 : undefined }}
        className={`group relative py-2 px-3 -mx-3 rounded-md cursor-pointer transition-colors ${selected ? "ring-2 ring-blue-400 bg-blue-50/50" : "hover:bg-slate-50"} ${isDragging ? "opacity-60" : ""}`}
      >
        <div className="absolute -left-2 top-2 flex flex-col opacity-30 group-hover:opacity-100 transition-opacity">
          <button ref={setDragRef} {...listeners} {...attributes} type="button" onClick={(e) => e.stopPropagation()} className="text-slate-400 hover:text-slate-700 cursor-grab active:cursor-grabbing" title="Drag to reorder">
            <GripVertical className="h-4 w-4" />
          </button>
        </div>
        <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete" className="absolute right-2 top-2 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
          <Trash2 className="h-4 w-4" />
        </button>
        <BlockPreview block={block} fieldLabel={fieldLabel} fillInTheBlankTemplate={fillInTheBlankTemplate} />
      </div>
    </div>
  );
}

/**
 * A "pinned" block (Logo/Date) — taken out of the ordered stack entirely
 * and rendered as a free-floating overlay at its own x/y, draggable to any
 * exact spot on the page rather than just reordered up/down. The whole box
 * is grabbable via its own small grip handle (top-left corner) so it
 * doesn't collide with the click-to-select behavior on the rest of the box.
 */
function PinnedBlock({
  block, selected, blockRef, fieldLabel, fillInTheBlankTemplate, onSelect, onDelete,
}: {
  block: DocumentBlock;
  selected: boolean;
  blockRef: (el: HTMLDivElement | null) => void;
  fieldLabel: (name: string) => string;
  fillInTheBlankTemplate: (name: string) => string | null;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({ id: block.id, data: { kind: "pinned" } satisfies ActiveData });
  return (
    <div
      ref={blockRef}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      style={{
        ...pinnedBlockStyle(block),
        transform: isDragging ? `translate(${transform?.x ?? 0}px, ${transform?.y ?? 0}px)` : undefined,
        zIndex: isDragging ? 30 : 5,
      }}
      className={`pinned-block group cursor-pointer rounded-md ${selected ? "ring-2 ring-blue-400" : "hover:ring-1 hover:ring-blue-300/70"} ${isDragging ? "opacity-70" : ""}`}
    >
      <button ref={setDragRef} {...listeners} {...attributes} type="button" onClick={(e) => e.stopPropagation()} title="Drag anywhere on the page" className="absolute -left-2 -top-2 bg-white rounded-full shadow p-0.5 text-slate-400 hover:text-slate-700 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity">
        <GripVertical className="h-3 w-3" />
      </button>
      <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete" className="absolute -right-2 -top-2 bg-white rounded-full shadow p-0.5 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
        <Trash2 className="h-3 w-3" />
      </button>
      <BlockPreview block={block} fieldLabel={fieldLabel} fillInTheBlankTemplate={fillInTheBlankTemplate} />
    </div>
  );
}

function BlockProperties({ block, formFields, onChange, onSnap }: { block: DocumentBlock; formFields: CustomFormField[]; onChange: (b: DocumentBlock) => void; onSnap: (align: "left" | "center" | "right") => void }) {
  const { companyId } = useAuth();
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const set = (patch: Partial<DocumentBlock>) => onChange({ ...block, ...patch });

  const insertVariable = (name: string) => {
    const token = `{{${name}}}`;
    const el = textareaRef.current;
    const current = block.text ?? "";
    if (el && document.activeElement === el) {
      const start = el.selectionStart ?? current.length;
      const end = el.selectionEnd ?? current.length;
      set({ text: current.slice(0, start) + token + current.slice(end) });
    } else {
      set({ text: `${current}${token}` });
    }
  };

  let content: React.ReactNode = null;

  if (block.type === "heading" || block.type === "paragraph") {
    content = (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Text</label>
          <textarea
            ref={textareaRef}
            value={block.text ?? ""}
            onChange={(e) => set({ text: e.target.value })}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const name = e.dataTransfer.getData("text/plain"); if (name) insertVariable(name); }}
            className="glass-input text-sm py-1.5 px-2.5 rounded-md min-h-20"
          />
        </div>
        {formFields.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Variables — click or drag into the text</label>
            <div className="flex flex-wrap gap-1.5">
              {formFields.map((f) => (
                <button key={f.id} type="button" draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", f.name)} onClick={() => insertVariable(f.name)} className="text-[10px] px-2 py-1 rounded bg-blue-500/15 text-blue-300 border border-blue-500/25 cursor-grab">
                  {`{{${f.name}}}`}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  } else if (block.type === "image") {
    const handleUpload = async (file: File) => {
      if (!companyId) return;
      setUploading(true);
      try {
        const { url } = await uploadCustomFormAsset(companyId, file);
        set({ imageUrl: url });
      } finally {
        setUploading(false);
      }
    };
    content = (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Upload</label>
          <input type="file" accept="image/*" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); }} className="text-xs" />
          {uploading && <span className="text-[10px] text-muted-foreground">Uploading…</span>}
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Or Image URL</label>
          <input type="text" value={block.imageUrl ?? ""} onChange={(e) => set({ imageUrl: e.target.value })} placeholder="https://…" className="glass-input text-sm py-1.5 px-2.5 rounded-md" />
        </div>
      </div>
    );
  } else if (block.type === "fieldValue") {
    content = (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Field</label>
          <select value={block.fieldName ?? ""} onChange={(e) => set({ fieldName: e.target.value })} className="glass-input text-sm py-1.5 px-2.5 rounded-md">
            <option value="">Choose a field…</option>
            {formFields.map((f) => <option key={f.id} value={f.name}>{f.label || f.name}</option>)}
          </select>
          <p className="text-[10px] text-muted-foreground mt-1">A signature/file answer embeds as an image; anything else prints as text.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={block.showLabel !== false} onChange={(e) => set({ showLabel: e.target.checked })} /> Show "Label:" prefix</label>
      </div>
    );
  } else if (block.type === "date") {
    content = <p className="text-xs text-muted-foreground">Shows the date the response was submitted, formatted automatically (e.g. "{formatDocumentDate(new Date())}").</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {content ?? <p className="text-xs text-muted-foreground">This block has no content settings.</p>}
      <div className="flex flex-col gap-3 pt-3 border-t border-white/10">
        <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Style</h4>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={!!block.position}
            onChange={(e) => set({
              // A block coming out of the flow was very likely full-width
              // (100 is the default for every type) — pinned at that width
              // it'd span the whole page and barely look "freely draggable"
              // at all, unlike the compact Logo/Date. An image genuinely
              // benefits from a deliberate percentage width (controls how
              // big the logo prints), but text reads better shrunk to fit
              // its own content — no dead space trailing past the letters.
              position: e.target.checked ? (block.position ?? { x: 200, y: 10 }) : undefined,
              width: e.target.checked && block.width === 100 ? 33 : block.width,
              displayMode: e.target.checked && block.type !== "image" ? "shrink" : block.displayMode,
            })}
          />
          Pin to page (drag it anywhere instead of reordering it in the stack below)
        </label>
        {block.position && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Snap to</label>
            <div className="flex gap-1.5">
              {(["left", "center", "right"] as const).map((align) => (
                <button key={align} type="button" onClick={() => onSnap(align)} className="flex-1 text-[10px] px-1.5 py-1.5 rounded border border-white/10 hover:bg-white/5">
                  {align === "left" ? "Left" : align === "center" ? "Center" : "Right"}
                </button>
              ))}
            </div>
          </div>
        )}
        <StyleFields target={block} onChange={(patch) => onChange({ ...block, ...patch })} />
      </div>
    </div>
  );
}

export function DocumentTemplateEditor({ blocks, onChange, formFields, formTitle }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Structural form elements (Heading/Divider/Image/...) never collect a
  // submitted value, so they're not meaningful as a document variable or a
  // Field Value block — only actual data-collecting fields are offered.
  const dataFields = useMemo(() => formFields.filter((f) => ELEMENT_REGISTRY[f.type]?.kind === "field"), [formFields]);
  const fieldLabel = (name: string) => dataFields.find((f) => f.name === name)?.label || name;
  /** Null for any field that isn't a Fill in the Blank (or doesn't exist) — those tokens keep showing verbatim, same as today. */
  const fillInTheBlankTemplate = (name: string): string | null => {
    const f = dataFields.find((x) => x.name === name);
    return f?.type === "fillInTheBlank" ? (f.config.template ?? "") : null;
  };

  // A brand-new (empty) document design starts pre-populated with every
  // form field, in form order, so there's already something to organize
  // instead of a blank page — matches "preview all the form elements" the
  // user asked for. Runs once per mount (i.e. once per visit to this tab);
  // if the user later deletes every block, revisiting the tab re-seeds it,
  // which is an acceptable trade-off for never showing a dead-empty canvas
  // when a form actually has fields to show.
  useEffect(() => {
    if (blocks.length === 0 && dataFields.length > 0) {
      onChange([
        { ...defaultBlockFor("heading"), text: formTitle || "Untitled Form" },
        ...dataFields.map((f) => fieldValueBlockFor(f.name)),
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const referencedFieldNames = new Set(blocks.filter((b) => b.type === "fieldValue" && b.fieldName).map((b) => b.fieldName));
  const missingFields = dataFields.filter((f) => !referencedFieldNames.has(f.name));

  // Pinned blocks (Logo/Date) are free-floating overlays, not part of the
  // ordered stack — they're excluded from the flow's drag-reorder geometry
  // below and rendered separately, absolutely positioned on the page.
  const flowBlocks = blocks.filter((b) => !b.position);
  const pinnedBlocks = blocks.filter((b) => !!b.position);

  const updateBlock = (id: string, next: DocumentBlock) => onChange(blocks.map((b) => (b.id === id ? next : b)));
  const deleteBlock = (id: string) => { onChange(blocks.filter((b) => b.id !== id)); setSelectedId((sel) => (sel === id ? null : sel)); };
  const appendBlock = (type: DocumentBlockType) => { const b = defaultBlockFor(type); onChange([...blocks, b]); setSelectedId(b.id); };
  const addMissingFields = () => onChange([...blocks, ...missingFields.map((f) => fieldValueBlockFor(f.name))]);
  const addLogo = () => { const b = defaultLogoBlock(); onChange([...blocks, b]); setSelectedId(b.id); };
  const addDate = () => { const b = defaultDateBlock(); onChange([...blocks, b]); setSelectedId(b.id); };

  const rowNodes = useRef(new Map<string, HTMLDivElement>());
  const setRowRef = (id: string) => (el: HTMLDivElement | null) => { if (el) rowNodes.current.set(id, el); else rowNodes.current.delete(id); };

  const pinnedNodes = useRef(new Map<string, HTMLDivElement>());
  const setPinnedRef = (id: string) => (el: HTMLDivElement | null) => { if (el) pinnedNodes.current.set(id, el); else pinnedNodes.current.delete(id); };

  // "Snap to" needs the block's real rendered width — a "shrink to fit"
  // block (any pinned text by default now) has no fixed pixel width to
  // compute from, so this measures the actual DOM box rather than deriving
  // one from block.width (which only means anything in "block" display
  // mode — see pinnedBlockStyle). Pinned coordinates are relative to the
  // page's true outer corner, not the padding-inset area flow content
  // lives in (see PAGE_PADDING) — snapping to literal x=0/PAGE_CONTENT_WIDTH
  // would land flush with the page edge, outside the margin flow content
  // respects, so "left"/"right" line up with PAGE_PADDING on each side
  // instead, matching flow content's actual margins.
  const snapPinnedBlock = (block: DocumentBlock, align: "left" | "center" | "right") => {
    if (!block.position) return;
    const el = pinnedNodes.current.get(block.id);
    const widthPx = el ? el.getBoundingClientRect().width : (block.width / 100) * PAGE_CONTENT_WIDTH;
    const x =
      align === "left"
        ? PAGE_PADDING
        : align === "right"
        ? PAGE_WIDTH - PAGE_PADDING - widthPx
        : PAGE_PADDING + (PAGE_CONTENT_WIDTH - widthPx) / 2;
    updateBlock(block.id, { ...block, position: { x: Math.round(x), y: block.position.y } });
  };

  // Pinned blocks (Logo/Date) can visually overlap the flowing content
  // below them, so the flow container gets pushed down by however far the
  // lowest pinned block's actual rendered bottom edge reaches — measured
  // against the real DOM (via ResizeObserver, so an async-loading Logo
  // image growing into its final size re-triggers this too), the same way
  // generate.ts's reflowFlowContentBelowPinnedBlocks does for the PDF.
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [headerReserve, setHeaderReserve] = useState(0);
  useEffect(() => {
    const pageEl = pageRef.current;
    if (!pageEl) return;
    const recompute = () => {
      const pinnedEls = Array.from(pageEl.querySelectorAll<HTMLElement>(".pinned-block"));
      setHeaderReserve(pinnedEls.reduce((max, el) => Math.max(max, el.offsetTop + el.offsetHeight), 0));
    };
    recompute();
    const observer = new ResizeObserver(recompute);
    pageEl.querySelectorAll(".pinned-block").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [blocks]);

  const [isDragging, setIsDragging] = useState(false);
  const [insertBeforeId, setInsertBeforeId] = useState<string | null>(null);

  const computeInsertBeforeId = (centerY: number): string | null => {
    for (const b of flowBlocks) {
      const el = rowNodes.current.get(b.id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (centerY < rect.top + rect.height / 2) return b.id;
    }
    return null;
  };

  // Keeps a dragged pinned block on the printable page instead of letting
  // it get dropped into the margins or off the edge entirely.
  const clampPinnedPosition = (block: DocumentBlock, x: number, y: number) => {
    const widthPx = (block.width / 100) * PAGE_CONTENT_WIDTH;
    return {
      x: Math.max(0, Math.min(x, PAGE_CONTENT_WIDTH - widthPx)),
      y: Math.max(0, Math.min(y, PAGE_CONTENT_HEIGHT - 24)),
    };
  };

  const handleDragStart = (_e: DragStartEvent) => setIsDragging(true);
  const handleDragMove = (event: DragMoveEvent) => {
    const activeData = event.active.data.current as ActiveData | undefined;
    // Pinned blocks move freely with the cursor (handled entirely by their
    // own live `transform`) — they never insert into the ordered stack, so
    // there's no indicator line to compute.
    if (activeData?.kind === "pinned") return;
    const translated = event.active.rect.current?.translated;
    if (!translated) return;
    setInsertBeforeId(computeInsertBeforeId(translated.top + translated.height / 2));
  };
  const handleDragEnd = (event: DragEndEvent) => {
    setIsDragging(false);
    const activeData = event.active.data.current as ActiveData | undefined;

    if (activeData?.kind === "pinned") {
      const block = blocks.find((b) => b.id === event.active.id);
      if (block?.position) {
        const position = clampPinnedPosition(block, block.position.x + event.delta.x, block.position.y + event.delta.y);
        updateBlock(block.id, { ...block, position });
      }
      return;
    }

    const translated = event.active.rect.current?.translated;
    if (!translated) return;
    const target = computeInsertBeforeId(translated.top + translated.height / 2);

    if (activeData?.kind === "palette") {
      const created = defaultBlockFor(activeData.type);
      if (target === null) { onChange([...blocks, created]); }
      else {
        const idx = blocks.findIndex((b) => b.id === target);
        onChange(idx === -1 ? [...blocks, created] : [...blocks.slice(0, idx), created, ...blocks.slice(idx)]);
      }
      setSelectedId(created.id);
      return;
    }

    const from = blocks.findIndex((b) => b.id === event.active.id);
    if (from === -1) return;
    let to = target === null ? blocks.length - 1 : blocks.findIndex((b) => b.id === target);
    if (to === -1) to = blocks.length - 1;
    if (to > from) to -= 1;
    if (to === from) return;
    onChange(arrayMove(blocks, from, to));
  };

  const selectedBlock = blocks.find((b) => b.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">Design the PDF layout for "{formTitle || "this form"}" — every submission can be viewed as a document built from this design. Drag blocks below to reorder how they'll print.</p>

      <DndContext onDragStart={handleDragStart} onDragMove={handleDragMove} onDragEnd={handleDragEnd} onDragCancel={() => setIsDragging(false)}>
        <div className="flex gap-4 items-start">
          <div className="w-44 shrink-0 flex flex-col gap-1.5 sticky top-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Drag onto the page</p>
            {PALETTE.map((p) => <PaletteItem key={p.type} type={p.type} icon={p.icon} onClick={() => appendBlock(p.type)} />)}
            {missingFields.length > 0 && (
              <button type="button" onClick={addMissingFields} className="mt-2 w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 text-xs font-medium text-blue-300 text-left">
                <Plus className="h-3.5 w-3.5 shrink-0" /> Add {missingFields.length} missing field{missingFields.length === 1 ? "" : "s"}
              </button>
            )}

            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5 mt-3 pt-3 border-t border-white/10">Pin to page — drag anywhere</p>
            <button type="button" onClick={addLogo} className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 text-xs font-medium text-left transition-colors">
              <ImageIcon className="h-3.5 w-3.5 text-blue-300 shrink-0" /> Logo
            </button>
            <button type="button" onClick={addDate} className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 text-xs font-medium text-left transition-colors">
              <Calendar className="h-3.5 w-3.5 text-blue-300 shrink-0" /> Date
            </button>
          </div>

          <div className="flex-1 min-w-0 flex justify-center bg-slate-800/40 rounded-lg p-6" onClick={() => setSelectedId(null)}>
            {/* The page always represents white paper — its text must stay dark regardless of the app's own light/dark theme, so color is set explicitly here rather than left to inherit the app's (theme-dependent) foreground color. Matches generate.ts's .doc-page color exactly, so the live preview and the actual generated PDF always agree. */}
            <div ref={pageRef} className="bg-white shadow-xl" style={{ width: PAGE_WIDTH, minHeight: PAGE_HEIGHT, padding: PAGE_PADDING, boxSizing: "border-box", position: "relative", color: "#111827" }}>
              <div className="flex flex-wrap" style={{ paddingTop: headerReserve || undefined }}>
                {flowBlocks.map((b) => (
                  <BlockRow key={b.id} block={b} selected={selectedId === b.id} rowRef={setRowRef(b.id)} showIndicatorAbove={isDragging && insertBeforeId === b.id} fieldLabel={fieldLabel} fillInTheBlankTemplate={fillInTheBlankTemplate} onSelect={() => setSelectedId(b.id)} onDelete={() => deleteBlock(b.id)} />
                ))}
              </div>
              {isDragging && insertBeforeId === null && flowBlocks.length > 0 && <div className="h-0.5 mb-1.5 rounded bg-blue-400" />}
              <div className={`mt-2 rounded-md border-2 border-dashed text-center py-6 text-xs transition-colors ${isDragging ? "border-blue-400 bg-blue-50 text-blue-500" : "border-slate-200 text-slate-400"}`}>
                {flowBlocks.length === 0 ? "Drag a block here to get started" : "Drop here to add another block"}
              </div>

              {pinnedBlocks.map((b) => (
                <PinnedBlock key={b.id} block={b} selected={selectedId === b.id} blockRef={setPinnedRef(b.id)} fieldLabel={fieldLabel} fillInTheBlankTemplate={fillInTheBlankTemplate} onSelect={() => setSelectedId(b.id)} onDelete={() => deleteBlock(b.id)} />
              ))}
            </div>
          </div>

          <div className="w-72 shrink-0 sticky top-4 panel p-4 max-h-[85vh] overflow-y-auto">
            {selectedBlock ? (
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold pb-2 border-b border-white/10">{BLOCK_TYPE_LABELS[selectedBlock.type]}</h3>
                <BlockProperties block={selectedBlock} formFields={dataFields} onChange={(next) => updateBlock(selectedBlock.id, next)} onSnap={(align) => snapPinnedBlock(selectedBlock, align)} />
                <button type="button" onClick={() => deleteBlock(selectedBlock.id)} className="text-xs text-red-400 hover:text-red-300 self-start flex items-center gap-1 mt-1"><Trash2 className="h-3 w-3" /> Delete block</button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Select a block on the page to edit it.</p>
            )}
          </div>
        </div>
      </DndContext>
    </div>
  );
}
