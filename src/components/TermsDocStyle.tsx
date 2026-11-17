/**
 * How Terms & Conditions read — the accept window, Preview, History and
 * Profile all use it, so what an admin previews is what people see.
 * In the system's dark colours (not a white paper): light-gray text, white
 * bold section headings with a faint rule above, sky-blue sub-headings and
 * bullets, on a dark panel (TERMS_DOC_PANEL). Light mode (data-theme="light")
 * gets its own set: dark text on the system cream card, blue sub-headings.
 */

export const TERMS_DOC_CLASS = "terms-doc";
/** The panel the text sits on — dark in dark mode, the cream card in light mode. */
export const TERMS_DOC_PANEL = "terms-doc-panel";

const STYLES = `
  .terms-doc { font-size: 15px; line-height: 1.7; color: #cbd5e1; }
  .terms-doc h2 { font-size: 1.05rem; font-weight: 700; line-height: 1.35; color: #f8fafc; margin: 1.75rem 0 0.55rem; padding-top: 1.1rem; border-top: 1px solid rgba(148, 163, 184, 0.16); text-wrap: balance; }
  .terms-doc h3 { font-size: 0.95rem; font-weight: 700; color: #7dd3fc; margin: 1.15rem 0 0.35rem; }
  .terms-doc p { margin: 0.55rem 0; }
  .terms-doc ul { list-style: disc; padding-left: 1.6rem; margin: 0.4rem 0 0.8rem; }
  .terms-doc ol { list-style: decimal; padding-left: 1.6rem; margin: 0.4rem 0 0.8rem; }
  .terms-doc li { margin: 0.25rem 0; padding-left: 0.15rem; }
  .terms-doc li::marker { color: #38bdf8; }
  .terms-doc li p { margin: 0; }
  .terms-doc strong, .terms-doc b { font-weight: 700; color: #f1f5f9; }
  .terms-doc > :first-child { margin-top: 0; padding-top: 0; border-top: 0; }
  .terms-doc > :last-child { margin-bottom: 0; }
  .terms-doc-panel { background-color: rgba(2, 6, 23, 0.55); }
  .terms-info { border: 1px solid rgba(56, 189, 248, 0.22); background-color: rgba(56, 189, 248, 0.06); color: #cbd5e1; }
  .terms-info dt { color: #f1f5f9; }
  .terms-info .terms-info-title { color: #7dd3fc; }

  :root[data-theme="light"] .terms-doc { color: #334155; }
  :root[data-theme="light"] .terms-doc h2 { color: #0f172a; border-top-color: rgba(15, 23, 42, 0.12); }
  :root[data-theme="light"] .terms-doc h3 { color: #0369a1; }
  :root[data-theme="light"] .terms-doc strong, :root[data-theme="light"] .terms-doc b { color: #0f172a; }
  :root[data-theme="light"] .terms-doc li::marker { color: #0284c7; }
  :root[data-theme="light"] .terms-doc-panel { background-color: #fffcf6; }
  :root[data-theme="light"] .terms-info { border-color: rgba(2, 132, 199, 0.25); background-color: rgba(2, 132, 199, 0.06); color: #334155; }
  :root[data-theme="light"] .terms-info dt { color: #0f172a; }
  :root[data-theme="light"] .terms-info .terms-info-title { color: #0369a1; }
`;

export function TermsDocStyleTag() {
  return <style>{STYLES}</style>;
}
