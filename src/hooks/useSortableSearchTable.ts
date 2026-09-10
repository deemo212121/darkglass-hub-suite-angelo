import { useMemo, useState } from "react";

/**
 * Shared "search box + click-to-sort + per-column funnel filter" behavior
 * for the many near-identical Sent History tables in ReportHRDaily.tsx —
 * one hook instead of re-deriving the same state per table.
 *
 * `valueFor` is optional and only needed for columns that use the funnel
 * filter (a low-cardinality column like Branch/Status/Sent By, where
 * picking from a checklist of the values that actually occur makes more
 * sense than a free-text search) — sort-only columns like a name or a date
 * don't need it. Search runs first, then column filters, then sort — same
 * "narrow down, then order what's left" order a user would expect.
 */
export function useSortableSearchTable<T, C extends string>(
  rows: T[],
  matchesSearch: (row: T, query: string) => boolean,
  keyFor: (row: T, column: C) => string | number,
  valueFor?: (row: T, column: C) => string
) {
  const [search, setSearch] = useState("");
  const [sortColumn, setSortColumn] = useState<C | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [columnFilters, setColumnFilters] = useState<Partial<Record<C, Set<string>>>>({});

  const handleSort = (column: C) => {
    if (sortColumn === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDir("asc");
    }
  };

  // Distinct values that actually occur for this column, across ALL rows
  // (not just the currently-filtered set) — so unchecking a value in one
  // funnel never makes another funnel's own options shrink out from under it.
  const filterOptionsFor = (column: C): string[] => {
    if (!valueFor) return [];
    return Array.from(new Set(rows.map((r) => valueFor(r, column)))).sort((a, b) => a.localeCompare(b));
  };

  const toggleFilterValue = (column: C, value: string) => {
    setColumnFilters((prev) => {
      const allValues = filterOptionsFor(column);
      const current = prev[column] ?? new Set(allValues);
      const next = new Set(current);
      if (next.has(value)) next.delete(value); else next.add(value);
      const copy = { ...prev };
      // Every value checked again is the same as "no filter" — drop the
      // entry entirely rather than carry around a redundant full set.
      if (next.size >= allValues.length) delete copy[column];
      else copy[column] = next;
      return copy;
    });
  };
  const clearColumnFilter = (column: C) =>
    setColumnFilters((prev) => {
      const copy = { ...prev };
      delete copy[column];
      return copy;
    });
  const isColumnFiltered = (column: C) => !!columnFilters[column];
  const isValueChecked = (column: C, value: string) => {
    const set = columnFilters[column];
    return !set || set.has(value);
  };

  const filtered = useMemo(() => {
    let result = rows;
    const q = search.trim().toLowerCase();
    if (q) result = result.filter((r) => matchesSearch(r, q));
    if (valueFor) {
      for (const column of Object.keys(columnFilters) as C[]) {
        const set = columnFilters[column];
        if (!set) continue;
        result = result.filter((r) => set.has(valueFor(r, column)));
      }
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, columnFilters]);

  const sorted = useMemo(() => {
    if (!sortColumn) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const ka = keyFor(a, sortColumn);
      const kb = keyFor(b, sortColumn);
      if (ka < kb) return -1 * dir;
      if (ka > kb) return 1 * dir;
      return 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortColumn, sortDir]);

  return {
    search, setSearch,
    sortColumn, sortDir, handleSort,
    filterOptionsFor, toggleFilterValue, clearColumnFilter, isColumnFiltered, isValueChecked,
    rows: sorted,
  };
}
