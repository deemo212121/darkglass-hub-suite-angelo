import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AccountPageShell } from "@/components/AccountPageShell";
import { Save } from "lucide-react";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — Admin Hub Solutions" }] }),
  component: SettingsPage,
});

type Settings = {
  emailNotifications: boolean;
  smsNotifications: boolean;
  pushNotifications: boolean;
  weeklyDigest: boolean;
  compactTables: boolean;
  theme: "dark" | "system";
  language: string;
  timezone: string;
};
const KEY = "ahs:settings";
const DEFAULTS: Settings = {
  emailNotifications: true, smsNotifications: false, pushNotifications: true, weeklyDigest: true,
  compactTables: false, theme: "dark", language: "en-US", timezone: "America/Chicago",
};

function SettingsPage() {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    const raw = localStorage.getItem(KEY);
    if (raw) { try { setS({ ...DEFAULTS, ...JSON.parse(raw) }); } catch {} }
  }, []);

  const save = () => {
    localStorage.setItem(KEY, JSON.stringify(s));
    setSaved("Settings saved.");
    setTimeout(() => setSaved(""), 2000);
  };

  return (
    <AccountPageShell title="Settings" description="Tune notifications and app preferences.">
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="panel">
          <h2 className="text-lg font-semibold mb-4">Notifications</h2>
          <div className="grid gap-3">
            <Toggle label="Email notifications" desc="Receive ticket and parts updates by email." checked={s.emailNotifications} onChange={(v) => setS({ ...s, emailNotifications: v })} />
            <Toggle label="SMS notifications" desc="Urgent updates via text message." checked={s.smsNotifications} onChange={(v) => setS({ ...s, smsNotifications: v })} />
            <Toggle label="Push notifications" desc="In-app push alerts." checked={s.pushNotifications} onChange={(v) => setS({ ...s, pushNotifications: v })} />
            <Toggle label="Weekly digest" desc="Summary of activity each Monday." checked={s.weeklyDigest} onChange={(v) => setS({ ...s, weeklyDigest: v })} />
          </div>
        </section>
        <section className="panel">
          <h2 className="text-lg font-semibold mb-4">Preferences</h2>
          <div className="grid gap-4">
            <Toggle label="Compact tables" desc="Denser rows in data tables." checked={s.compactTables} onChange={(v) => setS({ ...s, compactTables: v })} />
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Theme</span>
              <select className="glass-input" value={s.theme} onChange={(e) => setS({ ...s, theme: e.target.value as Settings["theme"] })}>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Language</span>
              <select className="glass-input" value={s.language} onChange={(e) => setS({ ...s, language: e.target.value })}>
                <option value="en-US">English (US)</option>
                <option value="es-MX">Español (MX)</option>
                <option value="fr-FR">Français</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Timezone</span>
              <select className="glass-input" value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })}>
                <option>America/Chicago</option>
                <option>America/New_York</option>
                <option>America/Denver</option>
                <option>America/Los_Angeles</option>
              </select>
            </label>
          </div>
        </section>
      </div>
      <div className="flex items-center gap-3 mt-5">
        <button className="btn btn-primary" onClick={save}><Save className="h-4 w-4" />Save settings</button>
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
