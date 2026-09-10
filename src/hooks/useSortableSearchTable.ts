import { useMemo, useState } from "react";

/**
 * Shared "search box + click-to-sort columns" behavior for the many
 * near-identical Sent History tables in ReportHRDaily.tsx — one hook
 * instead of re-deriving the same search/sort state and useMemo pair per
 * table. Search runs before sort, same order a user would expect (narrow
 * down, then order what's left).
 */
export function useSortableSearchTable<T, C extends string>(
  rows: T[],
  matchesSearch: (row: T, query: string) => boolean,
  keyFor: (row: T, column: C) => string | number
) {
  const [search, setSearch] = useState("");
  const [sortColumn, setSortColumn] = useState<C | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const handleSort = (column: C) => {
    if (sortColumn === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDir("asc");
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => matchesSearch(r, q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search]);

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

  return { search, setSearch, sortColumn, sortDir, handleSort, rows: sorted };
}
