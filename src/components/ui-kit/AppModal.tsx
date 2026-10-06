/**
 * The app's standard popup frame — one look for every dialog:
 *   header  (optional icon) title, optional one-line description, ✕
 *   body    scrolls when long
 *   footer  actions bottom-right; Cancel / secondary first, the main action last
 * Esc and clicking outside close it (unless `busy`). Uses theme colours, so
 * it works in light and dark mode. Use the .btn / .btn-primary / .btn-danger
 * classes for the footer buttons.
 */
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const WIDTH = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" } as const;

export function AppModal({
  title,
  description,
  icon,
  onClose,
  footer,
  children,
  size = "md",
  busy = false,
  tone = "default",
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  children?: ReactNode;
  size?: keyof typeof WIDTH;
  /** While true, Esc / outside click / ✕ don't close (e.g. while saving). */
  busy?: boolean;
  /** "warning" gives the frame an amber edge — for "are you sure" moments. */
  tone?: "default" | "warning";
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px] animate-in fade-in duration-150"
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`flex max-h-[85vh] w-full ${WIDTH[size]} flex-col overflow-hidden rounded-xl border bg-[var(--color-card)] text-[var(--color-foreground)] shadow-2xl animate-in zoom-in-95 duration-150 ${
          tone === "warning" ? "border-amber-500/40" : "border-[var(--color-panel-border)]"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-[var(--color-panel-border)] px-5 py-4">
          {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold leading-snug">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-[var(--color-muted-foreground)]">{description}</p>}
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="btn btn-ghost btn-sm -mr-2 -mt-1" aria-label="Close">
            <X />
          </button>
        </div>
        {children !== undefined && <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>}
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-panel-border)] px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
