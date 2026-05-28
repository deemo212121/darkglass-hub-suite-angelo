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
  profileVisibility: "team",
  activityVisibility: "team",
  searchVisibility: true,
  timecardVisibility: "managers",
  notificationsVisible: true,
  idleLock: true,
  idleMinutes: 15,
};

function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <select className="glass-input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([valueOption, labelOption]) => <option key={valueOption} value={valueOption}>{labelOption}</option>)}
      </select>
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 rounded-lg border border-[var(--color-panel-border)] bg-[oklch(0.98_0.005_250/0.03)] px-3 py-2.5 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm font-medium">{label}</span>
    </label>
  );
}

function PrivacyPage() {
  const [privacy, setPrivacy] = useState<Privacy>(DEFAULTS);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      try {
        setPrivacy({ ...DEFAULTS, ...JSON.parse(raw) });
      } catch {}
    }
  }, []);

  const save = () => {
    localStorage.setItem(KEY, JSON.stringify(privacy));
    setSaved("Privacy preferences saved.");
    setTimeout(() => setSaved(""), 2000);
  };

  return (
    <AccountPageShell title="Privacy" description="Control who can see your activity and how the app locks.">
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="panel">
          <h2 className="text-lg font-semibold mb-4">Visibility</h2>
          <div className="grid gap-4">
            <Choice label="Profile visibility" value={privacy.profileVisibility} onChange={(v) => setPrivacy({ ...privacy, profileVisibility: v as Privacy["profileVisibility"] })} options={[["team", "My team"], ["company", "Whole company"], ["private", "Only me"]]} />
            <Choice label="Activity visibility" value={privacy.activityVisibility} onChange={(v) => setPrivacy({ ...privacy, activityVisibility: v as Privacy["activityVisibility"] })} options={[["team", "My team"], ["company", "Whole company"], ["private", "Only me"]]} />
            <Choice label="Timecard visibility" value={privacy.timecardVisibility} onChange={(v) => setPrivacy({ ...privacy, timecardVisibility: v as Privacy["timecardVisibility"] })} options={[["managers", "Managers only"], ["team", "My team"], ["private", "Only me"]]} />
          </div>
        </section>
        <section className="panel">
          <h2 className="text-lg font-semibold mb-4">Access & security</h2>
          <div className="grid gap-4">
            <Toggle label="Search visibility" checked={privacy.searchVisibility} onChange={(v) => setPrivacy({ ...privacy, searchVisibility: v })} />
            <Toggle label="Notifications visible" checked={privacy.notificationsVisible} onChange={(v) => setPrivacy({ ...privacy, notificationsVisible: v })} />
            <Toggle label="Idle lock" checked={privacy.idleLock} onChange={(v) => setPrivacy({ ...privacy, idleLock: v })} />
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Idle minutes</span>
              <input className="glass-input" type="number" min={1} max={120} value={privacy.idleMinutes} onChange={(e) => setPrivacy({ ...privacy, idleMinutes: Number(e.target.value) })} disabled={!privacy.idleLock} />
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
