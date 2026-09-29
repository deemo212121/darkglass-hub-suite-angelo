import { branchAbbrev, branchDonutHex } from "@/lib/branchDisplay";

export interface BranchBar {
  /** Branch / location name as stored on the ticket ("" or noLocationKey for none). */
  location: string;
  total: number;
  /** Extra hover text, e.g. "3 not received · 1 received". */
  detail?: string;
}

/**
 * Horizontal "parts by branch" bar chart shared by the Parts pages' Branch
 * Summary (Part Receive, Part Return, Part Daily Collection): one bar per
 * branch in its fixed branch color, count + share label, a total badge that
 * clears the branch filter, and click-a-bar-to-filter. Shows every branch —
 * no internal scroll.
 */
export function BranchBarChart({
  title,
  totalLabel,
  unitLabel,
  bars,
  selected,
  onSelect,
  noLocationKey,
}: {
  title: string;
  /** e.g. "Total Parts for Receive" */
  totalLabel: string;
  /** X-axis caption, e.g. "Number of Parts" */
  unitLabel: string;
  bars: BranchBar[];
  /** Currently filtered branch ("" = all). */
  selected: string;
  onSelect: (location: string) => void;
  /** Sentinel location value meaning "no location on the ticket" — shown as N/A. */
  noLocationKey?: string;
}) {
  const sorted = [...bars].sort((a, b) => b.total - a.total || a.location.localeCompare(b.location));
  const grandTotal = sorted.reduce((s, b) => s + b.total, 0);
  const maxTotal = Math.max(1, ...sorted.map((b) => b.total));
  const step = maxTotal <= 10 ? 2 : maxTotal <= 25 ? 5 : maxTotal <= 50 ? 10 : Math.ceil(maxTotal / 50) * 10;
  const axisMax = Math.ceil(maxTotal / step) * step;
  const ticks = Array.from({ length: axisMax / step + 1 }, (_, i) => i * step);
  const pct = (n: number) => (grandTotal > 0 ? ((n / grandTotal) * 100).toFixed(1) : "0.0");
  const isNone = (loc: string) => !loc || loc === noLocationKey;
  const [totalLine1, ...rest] = totalLabel.split(" ");

  return (
    <div className="lg:w-[40%] lg:shrink-0 rounded-lg border border-[var(--color-panel-border)] p-4 flex flex-col min-h-0">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-base font-bold text-foreground leading-tight">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {totalLabel}: <span className="font-semibold text-foreground tabular-nums">{grandTotal}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => onSelect("")}
          title="Show all branches"
          className={`shrink-0 flex items-center gap-2 rounded-lg border px-3 py-1.5 transition ${
            selected === "" ? "border-blue-400/50 bg-blue-500/10" : "border-[var(--color-panel-border)] bg-white/5 hover:bg-white/10"
          }`}
        >
          <span className="text-2xl font-bold text-foreground tabular-nums leading-none">{grandTotal}</span>
          <span className="text-[10px] leading-tight text-muted-foreground text-left">
            {totalLine1}
            <br />
            {rest.join(" ")}
          </span>
        </button>
      </div>

      {sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-6 text-center">No parts in this view.</p>
      ) : (
        <>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-12 right-20">
              {ticks.map((t) => (
                <div key={t} className="absolute inset-y-0 border-l border-[var(--color-panel-border)] opacity-50" style={{ left: `${(t / axisMax) * 100}%` }} />
              ))}
            </div>
            <div className="relative flex flex-col gap-1">
              {sorted.map((b) => {
                const active = selected === b.location;
                const dimmed = selected !== "" && !active;
                const color = isNone(b.location) ? "#64748b" : branchDonutHex(b.location);
                return (
                  <button
                    key={b.location || "__none__"}
                    type="button"
                    onClick={() => onSelect(active ? "" : b.location)}
                    title={`${isNone(b.location) ? "No location" : b.location}${b.detail ? ` — ${b.detail}` : ""}`}
                    className={`flex items-center rounded text-left transition ${active ? "bg-white/10" : "hover:bg-white/5"} ${dimmed ? "opacity-40" : ""}`}
                  >
                    <span className="w-12 shrink-0 pr-2 text-right text-[11px] font-semibold text-muted-foreground">
                      {isNone(b.location) ? "N/A" : branchAbbrev(b.location)}
                    </span>
                    <span className="relative flex-1 h-4">
                      <span
                        className="absolute inset-y-0 left-0 rounded-r"
                        style={{ width: `${Math.max(1.5, (b.total / axisMax) * 100)}%`, background: color }}
                      />
                    </span>
                    <span className="w-20 shrink-0 pl-2 text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                      <span className="font-bold text-foreground">{b.total}</span> ({pct(b.total)}%)
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-2 border-t border-[var(--color-panel-border)] pt-1">
            <div className="relative ml-12 mr-20 h-4">
              {ticks.map((t) => (
                <span key={t} className="absolute -translate-x-1/2 text-[10px] text-muted-foreground tabular-nums" style={{ left: `${(t / axisMax) * 100}%` }}>
                  {t}
                </span>
              ))}
            </div>
            <p className="text-center text-[10px] text-muted-foreground mt-1">{unitLabel}</p>
          </div>
        </>
      )}
    </div>
  );
}
