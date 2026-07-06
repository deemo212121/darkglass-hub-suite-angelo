/**
 * TicketColumnFilter — small funnel icon that opens a checkbox dropdown of
 * every distinct value in a single ticket-list column. Selecting "Select All"
 * clears the filter (shows everything). The funnel turns blue when a filter
 * is active. Designed to live inline next to a `<th>` label.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Filter } from "lucide-react";

interface Props {
  /** Distinct option values present in the column right now (after every OTHER filter). */
  options: string[];
  /** Currently selected values. Empty set = no filter (show all). */
  selected: Set<string>;
  /** Replace the selected set. Pass an empty set to clear. */
  onChange: (next: Set<string>) => void;
  /** Label shown at the top of the dropdown ("Filter by City", etc). */
  label?: string;
  /** Optional className for the wrapping span. */
  className?: string;
}

const EMPTY_LABEL = "(blank)";

export function TicketColumnFilter({ options, selected, onChange, label, className }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLSpanElement>(null);

  // Close on outside click / escape.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const sortedOptions = useMemo(() => {
    const all = Array.from(new Set(options));
    return all.sort((a, b) => {
      // Empty strings sort to bottom.
      if (!a && b) return 1;
      if (a && !b) return -1;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    });
  }, [options]);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedOptions;
    return sortedOptions.filter((opt) => (opt || EMPTY_LABEL).toLowerCase().includes(q));
  }, [sortedOptions, query]);

  const allSelected = selected.size === 0; // empty = show all
  const hasFilter = selected.size > 0;

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };

  const selectAll = () => onChange(new Set()); // clear filter

  return (
    <span ref={wrapperRef} className={`relative inline-flex items-center ${className ?? ""}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`ml-1 inline-flex h-4 w-4 items-center justify-center rounded transition ${
          hasFilter
            ? "text-blue-300 hover:text-blue-200"
            : "text-slate-500 hover:text-slate-200"
        }`}
        title={hasFilter ? `${selected.size} selected — click to change` : "Filter this column"}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Filter className="h-3 w-3" fill={hasFilter ? "currentColor" : "none"} strokeWidth={2} />
      </button>
      {open ? (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-60 rounded-md border border-[var(--color-panel-border)] bg-[var(--color-card)] p-2 text-xs text-foreground shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {label ? (
            <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {label}
            </div>
          ) : null}
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="mb-1 w-full rounded border border-[var(--color-panel-border)] bg-[var(--color-background)] px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-blue-500"
            autoFocus
          />
          <label className="flex items-center gap-2 rounded px-2 py-1 hover:bg-[var(--color-secondary)] cursor-pointer border-b border-[var(--color-panel-border)] mb-1">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={selectAll}
              className="accent-blue-500"
            />
            <span className="font-semibold">(Select All)</span>
          </label>
          <div className="max-h-56 overflow-y-auto">
            {filteredOptions.length === 0 ? (
              <div className="px-2 py-2 text-muted-foreground italic">No matches</div>
            ) : (
              filteredOptions.map((opt) => {
                const display = opt || EMPTY_LABEL;
                const isChecked = !allSelected && selected.has(opt);
                return (
                  <label
                    key={opt || "__empty__"}
                    className="flex items-center gap-2 rounded px-2 py-1 hover:bg-[var(--color-secondary)] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggle(opt)}
                      className="accent-blue-500"
                    />
                    <span className="truncate" title={display}>
                      {display}
                    </span>
                  </label>
                );
              })
            )}
          </div>
          {hasFilter ? (
            <button
              type="button"
              onClick={selectAll}
              className="mt-1 w-full rounded border border-[var(--color-panel-border)] bg-[var(--color-background)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-foreground hover:bg-[var(--color-secondary)]"
            >
              Clear filter
            </button>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
