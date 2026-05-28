import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AccountPageShell } from "@/components/AccountPageShell";
import { Save } from "lucide-react";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy — Admin Hub Solutions" }] }),
  component: PrivacyPage,
});

type Privacy = {
  profileVisibility: "team" | "company" | "private";
  activityVisibility: "team" | "company" | "private";
  searchVisibility: boolean;
  timecardVisibility: "managers" | "team" | "private";
  notificationsVisible: boolean;
  idleLock: boolean;
  idleMinutes: number;
};
const KEY = "ahs:privacy";
const DEFAULTS: Privacy = {
  profileVisibility: "team", activityVisibility: "team", searchVisibility: true,
  timecardVisibility: "managers", notificationsVisible: true, idleLock: true, idleMinutes: 15,
};

function PrivacyPage() {
  const [p, setP] = useState<Privacy>(DEFAULTS);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    const raw = localStorage.getItem(KEY);
    if (raw) { try { setP({ ...DEFAULTS, ...JSON.parse(raw) }); } catch {} }
  }, []);

  const save = () => {
    localStorage.setItem(KEY, JSON.stringify(p));
    setSaved("Privacy preferences saved.");
    setTimeout(() => setSaved(""), 2000);
  };

  return (
    <AccountPageShell title="Privacy" description="Control who can see your activity and how the app locks.">
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="panel">
          <h2 className="text-lg font-semibold mb-4">Visibility</h2>
          <div className="grid gap-4">
            <Choice label="Profile visibility" value={p.profileVisibility} onChange={(v) => setP({ ...p, profileVisibility: v as Privacy["profileVisibility"] })} options={[["team","My team"],["company","Whole company"],["private","Only me"]]} />
            <Choice label="Activity visibility" value={p.activityVisibility} onChange={(v) => setP({ ...p, activityVisibility: v as Privacy["activityVisibility"] })} options={[["team","My team"],["company","Whole company"],["private","Only me"]]} />
            <Choice label="Timecard visibility" value={p.timecardVisibility} onChange={(v) => setP({ ...p, timecardVisibility: v as Privacy["timecardVisibility"] })} options={[["managers","Managers only"],["team","My team"],["private","Only me"]]} />
            <Toggle label="Appear in search" desc="Others can find you by name or email." checked={p.searchVisibility} onChange={(v) => setP({ ...p, searchVisibility: v })} />
            <Toggle label="Show notification previews" desc="Display message previews on the device." checked={p.notificationsVisible} onChange={(v) => setP({ ...p, notificationsVisible: v })} />
          </div>
        </section>
        <section className="panel">
          <h2 className="text-lg font-semibold mb-4">Session privacy</h2>
          <div className="grid gap-4">
            <Toggle label="Idle lock" desc="Automatically lock the app when inactive." checked={p.idleLock} onChange={(v) => setP({ ...p, idleLock: v })} />
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Idle lock after (minutes)</span>
              <input className="glass-input" type="number" min={1} max={120} value={p.idleMinutes} onChange={(e) => setP({ ...p, idleMinutes: Number(e.target.value) })} disabled={!p.idleLock} />
            </label>
          </div>
        </section>
      </div>
      <div className="flex items-center gap-3 mt-5">
        <button className="btn btn-primary" onClick={save}><Save className="h-4 w-4" />Save privacy</button>
        {saved && <span className="text-xs text-muted-foreground">{saved}</span>}
      </div>
    </AccountPageShell>
  );
}

function Toggle({ label, desc, checked, onChange }: { label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-[var(--color-panel-border)] bg-[oklch(0.98_0.005_250/0.03)] px-3 py-2.5 cursor-pointer">
      <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {desc && <span className="block text-xs text-muted-foreground">{desc}</span>}
      </span>
    </label>
  );
}

function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <select className="glass-input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
