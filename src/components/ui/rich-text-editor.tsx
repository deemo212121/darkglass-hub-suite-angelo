/**
 * A small TipTap-based rich text editor — headings (H2/H3), bold/italic/
 * underline, bullet/numbered lists, plus a "Fields" dropdown that inserts
 * {{field_name}} merge tokens (same convention Fill in the Blank already
 * uses, see basic.tsx's fillInTheBlankElement.insertVariable). Generic, not
 * tied to any one form element — currently wired into the Paragraph
 * element's PropertiesPanel (factories.tsx).
 *
 * Tailwind's preflight resets h2/h3 to `font-size: inherit`, so without
 * explicit rules here the toolbar's heading buttons would visibly do
 * nothing. RICH_TEXT_STYLES/RichTextStyleTag are exported so the same
 * rules can also be applied where the saved HTML is rendered outside this
 * editor (factories.tsx's paragraph FillInput/CanvasPreview) — otherwise
 * the actual filled-out form wouldn't match what was typed here.
 */
import { useEffect, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Heading2, Heading3 } from "lucide-react";

export const RICH_TEXT_CLASS = "rte-body";
export const RICH_TEXT_STYLES = `
  .rte-body h2 { font-size: 1.25rem; font-weight: 700; line-height: 1.3; margin: 0.5rem 0; }
  .rte-body h3 { font-size: 1.1rem; font-weight: 700; line-height: 1.3; margin: 0.4rem 0; }
  .rte-body p { margin: 0.35rem 0; }
  .rte-body ul { list-style: disc; padding-left: 1.25rem; margin: 0.35rem 0; }
  .rte-body ol { list-style: decimal; padding-left: 1.25rem; margin: 0.35rem 0; }
  .rte-body p:first-child, .rte-body h2:first-child, .rte-body h3:first-child { margin-top: 0; }
  .rte-body p:last-child, .rte-body ul:last-child, .rte-body ol:last-child { margin-bottom: 0; }
`;
export function RichTextStyleTag() {
  return <style>{RICH_TEXT_STYLES}</style>;
}

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  mergeFields: { name: string }[];
}

export function RichTextEditor({ value, onChange, mergeFields }: RichTextEditorProps) {
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
      }),
      Underline,
    ],
    content: value || "",
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: { class: `${RICH_TEXT_CLASS} min-h-36 max-h-72 overflow-y-auto text-sm text-slate-800 focus:outline-none px-2.5 py-2` },
    },
    immediatelyRender: false,
  });

  // TipTap only reads `content` at mount — sync later external changes (e.g.
  // the properties panel switching to a different field) explicitly.
  useEffect(() => {
    if (!editor) return;
    if (value !== editor.getHTML()) editor.commands.setContent(value || "", { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, value]);

  if (!editor) return null;

  const btnCls = (active: boolean) =>
    `flex items-center justify-center h-7 w-7 rounded-md border transition-colors ${
      active ? "border-blue-400/50 bg-blue-500/15 text-blue-300" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"
    }`;

  return (
    <div className="rounded-md border border-white/15 overflow-hidden">
      <RichTextStyleTag />
      <div className="flex flex-wrap items-center gap-1 px-1.5 py-1 border-b border-white/15 bg-slate-900/60">
        <button type="button" title="Bold" onClick={() => editor.chain().focus().toggleBold().run()} className={btnCls(editor.isActive("bold"))}><Bold className="h-3.5 w-3.5" /></button>
        <button type="button" title="Italic" onClick={() => editor.chain().focus().toggleItalic().run()} className={btnCls(editor.isActive("italic"))}><Italic className="h-3.5 w-3.5" /></button>
        <button type="button" title="Underline" onClick={() => editor.chain().focus().toggleUnderline().run()} className={btnCls(editor.isActive("underline"))}><UnderlineIcon className="h-3.5 w-3.5" /></button>
        <span className="w-px h-4 bg-white/15 mx-0.5" />
        <button type="button" title="Heading 2" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={btnCls(editor.isActive("heading", { level: 2 }))}><Heading2 className="h-3.5 w-3.5" /></button>
        <button type="button" title="Heading 3" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} className={btnCls(editor.isActive("heading", { level: 3 }))}><Heading3 className="h-3.5 w-3.5" /></button>
        <span className="w-px h-4 bg-white/15 mx-0.5" />
        <button type="button" title="Bullet List" onClick={() => editor.chain().focus().toggleBulletList().run()} className={btnCls(editor.isActive("bulletList"))}><List className="h-3.5 w-3.5" /></button>
        <button type="button" title="Numbered List" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={btnCls(editor.isActive("orderedList"))}><ListOrdered className="h-3.5 w-3.5" /></button>
        {mergeFields.length > 0 && (
          <div className="relative ml-auto">
            <button
              type="button"
              onClick={() => setFieldsOpen((o) => !o)}
              onBlur={() => setTimeout(() => setFieldsOpen(false), 150)}
              className="text-xs px-2 py-1 rounded-md border border-white/15 text-muted-foreground hover:text-foreground hover:bg-white/5"
            >
              Fields ▾
            </button>
            {fieldsOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 w-52 max-h-56 overflow-y-auto rounded-md border border-white/15 bg-slate-900 shadow-2xl">
                {mergeFields.map((f) => (
                  <button
                    key={f.name}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { editor.chain().focus().insertContent(`{{${f.name}}}`).run(); setFieldsOpen(false); }}
                    className="w-full text-left px-2.5 py-1.5 text-xs text-blue-300 hover:bg-white/10"
                  >
                    {`{{${f.name}}}`}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="bg-white">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
