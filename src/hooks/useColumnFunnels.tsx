import { useState, type FocusEvent } from "react";
import { TicketColumnFilter } from "@/components/TicketColumnFilter";

const NO_FILTER = new Set<string>();

/**
 * Excel-style funnel filters for one table — a funnel on each column header
 * lists the distinct values in that column; tick some to keep only those rows.
 *
 *   const f = useColumnFunnels(rows, { Branch: (r) => r.branch, Qty: (r) => String(r.qty) }, (r) => r.id);
 *   <th>Branch {f.funnel("Branch")}</th> … {f.visible.map((r) => <tr {...f.rowPin(r.id)}>…)}
 *
 * Each column's list comes from every row (not the already-filtered ones), so
 * ticking one funnel never shrinks another's list. A row someone is editing
 * (focus inside it — spread `rowPin(key)` on its <tr>) stays on screen until
 * they leave it, even if the new value no longer matches, so typing into a
 * filtered column doesn't make the row vanish mid-edit.
 */
export function useColumnFunnels<T>(
  rows: readonly T[],
  columns: Record<string, (row: T) => string>,
  keyOf: (row: T) => string
) {
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [pinned, setPinned] = useState<string | null>(null);

  const active = Object.entries(filters).filter(([col, sel]) => sel.size > 0 && columns[col]);
  const matches = (row: T) => active.every(([col, sel]) => sel.has(columns[col](row)));
  const visible: T[] = active.length === 0 ? [...rows] : rows.filter((r) => keyOf(r) === pinned || matches(r));

  /** The funnel button for a column header (null for a column it doesn't know). */
  const funnel = (col: string) =>
    columns[col] ? (
      <TicketColumnFilter
        options={rows.map((r) => columns[col](r))}
        selected={filters[col] ?? NO_FILTER}
        onChange={(next) => setFilters((prev) => ({ ...prev, [col]: next }))}
        label={`Filter by ${col}`}
      />
    ) : null;

  /** Spread on a row's <tr>: keeps it showing while focus is inside it. */
  const rowPin = (key: string) => ({
    onFocus: () => setPinned(key),
    onBlur: (e: FocusEvent<HTMLElement>) => {
      if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
      setPinned((p) => (p === key ? null : p));
    },
  });

  return {
    visible,
    funnel,
    rowPin,
    /** Key of the row being edited right now, if any. */
    pinned,
    /** How many columns currently have a filter. */
    activeCount: active.length,
    clear: () => setFilters({}),
    /** Replace every filter with just this one column showing these values. */
    only: (col: string, values: string[]) => setFilters({ [col]: new Set(values) }),
  };
}
