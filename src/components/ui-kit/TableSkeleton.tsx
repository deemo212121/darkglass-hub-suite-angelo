/**
 * Placeholder rows while a table loads — keeps the page's shape instead of
 * a bare "Loading…" line, so nothing jumps when the data arrives.
 */
export function TableSkeleton({ rows = 6, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="w-full overflow-hidden" role="status" aria-label="Loading">
      <div className="flex gap-3 border-b border-[var(--color-panel-border)] px-4 py-3">
        {Array.from({ length: cols }, (_, c) => (
          <div key={c} className="ui-skeleton h-3 flex-1" style={{ maxWidth: c === 0 ? 140 : undefined, opacity: 0.7 }} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-3 border-b border-[var(--color-panel-border)] px-4 py-3.5 last:border-b-0">
          {Array.from({ length: cols }, (_, c) => (
            <div
              key={c}
              className="ui-skeleton h-3 flex-1"
              style={{ maxWidth: c === 0 ? 140 : undefined, width: `${55 + ((r * 7 + c * 13) % 40)}%` }}
            />
          ))}
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
