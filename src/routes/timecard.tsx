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
    if (raw) {
      try {
        setEntries(JSON.parse(raw));
        return;
      } catch {}
    }
    const seed: Entry[] = Array.from({ length: 5 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
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

  const addRow = () => persist([{ id: `t-${Date.now()}`, date: today.toISOString().slice(0, 10), in: "08:00", out: "17:00", notes: "" }, ...entries]);
  const update = (id: string, key: keyof Entry, value: string) => persist(entries.map((entry) => (entry.id === id ? { ...entry, [key]: value } : entry)));
  const remove = (id: string) => persist(entries.filter((entry) => entry.id !== id));

  const filtered = useMemo(() => entries.filter((entry) => entry.date.startsWith(month)), [entries, month]);

  return (
    <AccountPageShell title="My Timecard" description="Review and edit your time in/out records.">
      <section className="panel mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Month</span>
            <input className="glass-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <div className="ml-auto flex items-center gap-3">
            <button className="btn" onClick={addRow}><Plus className="h-4 w-4" />Add row</button>
            <button className="btn btn-primary" onClick={() => persist(entries)}><Save className="h-4 w-4" />Save</button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--color-panel-border)] bg-[oklch(0.98_0.005_250/0.03)] p-3">
            <div className="text-xs text-muted-foreground">Entries this month</div>
            <div className="text-2xl font-semibold">{filtered.length}</div>
          </div>
          <div className="rounded-lg border border-[var(--color-panel-border)] bg-[oklch(0.98_0.005_250/0.03)] p-3">
            <div className="text-xs text-muted-foreground">Latest date</div>
            <div className="text-2xl font-semibold">{filtered[0]?.date ?? "-"}</div>
          </div>
          <div className="rounded-lg border border-[var(--color-panel-border)] bg-[oklch(0.98_0.005_250/0.03)] p-3">
            <div className="text-xs text-muted-foreground">Status</div>
            <div className="text-2xl font-semibold">{filtered.length ? "Active" : "No entries"}</div>
          </div>
        </div>
      </section>

      <section className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-[0.18em] text-muted-foreground">
            <tr>
              <th className="py-3 pr-3">Date</th>
              <th className="py-3 pr-3">In</th>
              <th className="py-3 pr-3">Out</th>
              <th className="py-3 pr-3">Notes</th>
              <th className="py-3 pr-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => (
              <tr key={entry.id} className="border-t border-[var(--color-panel-border)]">
                <td className="py-3 pr-3"><input className="glass-input min-w-36" type="date" value={entry.date} onChange={(e) => update(entry.id, "date", e.target.value)} /></td>
                <td className="py-3 pr-3"><input className="glass-input min-w-28" type="time" value={entry.in} onChange={(e) => update(entry.id, "in", e.target.value)} /></td>
                <td className="py-3 pr-3"><input className="glass-input min-w-28" type="time" value={entry.out} onChange={(e) => update(entry.id, "out", e.target.value)} /></td>
                <td className="py-3 pr-3"><input className="glass-input min-w-64" value={entry.notes} onChange={(e) => update(entry.id, "notes", e.target.value)} /></td>
                <td className="py-3 pr-3 text-right"><button className="btn" onClick={() => remove(entry.id)}><Trash2 className="h-4 w-4" />Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </AccountPageShell>
  );
}
