/**
 * Donut + legend card for the Parts pages' Branch Summary widgets (Part
 * Receive, Part Return, ...) — one shared component so every page's charts
 * look and behave identically instead of each page hand-rolling its own.
 * Same visual language as TechnicianPerformanceReport.tsx's own "Ticket
 * Outcomes" donut, generalized to N slices instead of a fixed 2.
 */
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

export const DONUT_TOOLTIP_STYLE = {
  background: "#ffffff",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  color: "#0f172a",
  fontSize: 12,
  fontWeight: 600,
  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
} as const;

// A small fixed categorical palette for donuts whose slices aren't already
// color-coded elsewhere on the page (e.g. Part From / Part Provider) — in
// first-seen order, since there's no other established per-entity color to
// match.
export const CATEGORICAL_DONUT_HEX = ["#3b82f6", "#f59e0b", "#a855f7", "#14b8a6", "#f43f5e", "#84cc16", "#6366f1"];
export const DONUT_OTHER_COLOR = "#64748b";
export const DONUT_TOP_N = 6;

/** Sorted-desc top N entries, folding the rest into a single "Other" slice
 *  — keeps a donut to a readable number of categorical hues (dataviz's own
 *  rule: a 9th series is never a generated hue) instead of cycling colors
 *  across many branches or however many distinct categories exist. */
export function topDonutSlices(counts: Record<string, number>, topN: number): { name: string; value: number }[] {
  const entries = Object.entries(counts).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, topN).map(([name, value]) => ({ name, value }));
  const rest = entries.slice(topN);
  const otherTotal = rest.reduce((sum, [, v]) => sum + v, 0);
  return otherTotal > 0 ? [...top, { name: "Other", value: otherTotal }] : top;
}

export function DonutSummaryCard({
  title,
  data,
  colorFor,
  centerValue,
  centerLabel,
}: {
  title: string;
  data: { name: string; value: number }[];
  colorFor: (name: string, index: number) => string;
  centerValue: string;
  centerLabel: string;
}) {
  return (
    <div className="flex-1 min-w-[260px] h-full rounded-lg border border-white/10 bg-white/[0.03] p-4 flex flex-col">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 shrink-0">{title}</p>
      {/* flex-1 + percentage radii — grows to fill however tall the card
          ends up (it stretches to match whatever list sits beside it),
          instead of a fixed pixel donut leaving empty space below it. */}
      <div className="relative flex-1 min-h-[140px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="52%"
              outerRadius="78%"
              paddingAngle={data.length > 1 ? 3 : 0}
              stroke="none"
            >
              {data.map((d, i) => <Cell key={d.name} fill={colorFor(d.name, i)} />)}
            </Pie>
            <Tooltip contentStyle={DONUT_TOOLTIP_STYLE} formatter={(v: any, n: any) => [v, n]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <p className="text-2xl font-bold">{centerValue}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{centerLabel}</p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 text-sm min-w-0 mt-3 shrink-0">
        {data.length === 0 && <p className="text-xs text-muted-foreground italic">No data.</p>}
        {data.map((d, i) => (
          <div key={d.name} className="flex items-center gap-2 min-w-0">
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: colorFor(d.name, i) }} />
            <span className="text-muted-foreground truncate">{d.name}</span>
            <span className="font-semibold ml-auto shrink-0">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
