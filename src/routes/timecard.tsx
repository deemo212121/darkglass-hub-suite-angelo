import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AccountPageShell } from "@/components/AccountPageShell";
import { Plus, Save, Trash2 } from "lucide-react";

export const Route = createFileRoute("/timecard")({
  head: () => ({ meta: [{ title: "My Timecard — Admin Hub Solutions" }] }),
  component: TimecardPage,
});

type Entry = { id: string; date: string; in: string; out: string; notes: string };
const KEY = "ahs:timecard";

function TimecardPage() {
  const today = new Date();
  const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState(monthKey);
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    const raw = localStorage.getItem(KEY);
    if (raw) { try { setEntries(JSON.parse(raw)); return; } catch {} }
    // seed a few entries
    const seed: Entry[] = Array.from({ length: 5 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - i);
      return {
        id: `seed-${i}`,
        date: d.toISOString().slice(0, 10),
        in: "08:00",
        out: i % 4 === 0 ? "18:30" : "17:00",
        notes: i % 3 === 0 ? "On-call coverage" : "",
      };
    });
    setEntries(seed);
  }, []);

  const persist = (next: Entry[]) => {
    setEntries(next);
    localStorage.setItem(KEY, JSON.stringify(next));
  };

  const inMonth = useMemo(() => entries.filter((e) => e.date.startsWith(month)), [entries, month]);

  const totals = useMemo(() => {
    let total = 0;
    for (const e of inMonth) {
      if (!e.in || !e.out) continue;
      const [h1, m1] = e.in.split(":").map(Number);
      const [h2, m2] = e.out.split(":").map(Number);
      const hrs = (h2 + m2 / 60) - (h1 + m1 / 60);
      if (hrs > 0) total += hrs;
    }
    const regular = Math.min(total, 160);
    const overtime = Math.max(0, total - 160);
    return { total, regular, overtime };
  }, [inMonth]);

  const addRow = () => persist([{ id: `t-${Date.now()}`, date: today.toISOString().slice(0, 10), in: "08:00", out: "17:00", notes: "" }, ...entries]);
  const update = (id: string, key: keyof Entry, value: string) => persist(entries.map((e) => e.id === id ? { ...e, [key]: value } : e));
  const remove = (id: string) => persist(entries.filter((e) => e.id !== id));

  return (
    <AccountPageShell title="My Timecard" description="Review and edit your time in/out records.">
      <section className="panel mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Month</span>
            <input className="glass-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <div className="grid grid-cols-3 gap-4 ml-auto">
            <Stat label="Total hours" value={totals.total.toFixed(1)} />
            <Stat label="Regular" value={totals.regular.toFixed(1)} />
            <Stat label="Overtime" value={totals.overtime.toFixed(1)} accent />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-4">
          <button className="btn btn-primary" onClick={addRow}><Plus className="h-4 w-4" />Add entry</button>
          <button className="btn" onClick={() => persist(entries)}><Save className="h-4 w-4" />Save</button>
          <div className="ml-auto text-xs text-muted-foreground">{inMonth.length} entries</div>
        </div>
      </section>

      <section className="panel" style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr><th>Date</th><th>Time In</th><th>Time Out</th><th>Hours</th><th>Notes</th><th style={{ width: 50 }}></th></tr>
          </thead>
          <tbody>
            {inMonth.map((e) => {
              const [h1, m1] = (e.in || "0:0").split(":").map(Number);
              const [h2, m2] = (e.out || "0:0").split(":").map(Number);
              const hrs = Math.max(0, (h2 + m2 / 60) - (h1 + m1 / 60));
              return (
                <tr key={e.id}>
                  <td><input type="date" value={e.date} onChange={(ev) => update(e.id, "date", ev.target.value)} /></td>
                  <td><input type="time" value={e.in} onChange={(ev) => update(e.id, "in", ev.target.value)} /></td>
                  <td><input type="time" value={e.out} onChange={(ev) => update(e.id, "out", ev.target.value)} /></td>
                  <td>{hrs.toFixed(2)}</td>
                  <td><input type="text" value={e.notes} onChange={(ev) => update(e.id, "notes", ev.target.value)} /></td>
                  <td><button className="text-destructive" onClick={() => remove(e.id)}><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              );
            })}
            {inMonth.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", padding: "2rem", color: "#6b7280" }}>No entries this month</td></tr>}
          </tbody>
        </table>
      </section>
    </AccountPageShell>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--color-panel-border)] bg-[oklch(0.98_0.005_250/0.04)] px-4 py-2 text-right">
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-semibold ${accent ? "text-[var(--color-primary)]" : ""}`}>{value}</div>
    </div>
  );
}
