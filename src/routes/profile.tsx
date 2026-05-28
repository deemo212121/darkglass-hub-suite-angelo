import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AccountPageShell } from "@/components/AccountPageShell";
import { useAuth } from "@/lib/auth";
import { Save } from "lucide-react";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "My Profile — Admin Hub Solutions" }] }),
  component: ProfilePage,
});

type Profile = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  department: string;
  title: string;
};

const KEY = "ahs:profile";

function ProfilePage() {
  const { email } = useAuth();
  const [profile, setProfile] = useState<Profile>({
    firstName: "",
    lastName: "",
    email: email ?? "",
    phone: "",
    department: "Service",
    title: "Technician",
  });
  const [password, setPassword] = useState({ current: "", next: "", confirm: "" });
  const [saved, setSaved] = useState<string>("");

  useEffect(() => {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      try {
        setProfile((current) => ({ ...current, ...JSON.parse(raw) }));
      } catch {}
    }
  }, []);

  const save = () => {
    localStorage.setItem(KEY, JSON.stringify(profile));
    setSaved("Profile saved.");
    setTimeout(() => setSaved(""), 2000);
  };

  const changePassword = () => {
    if (!password.next || password.next !== password.confirm) {
      setSaved("Passwords don't match.");
      return;
    }
    setPassword({ current: "", next: "", confirm: "" });
    setSaved("Password updated.");
    setTimeout(() => setSaved(""), 2000);
  };

  const field = (label: string, key: keyof Profile, type = "text") => (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        className="glass-input"
        type={type}
        value={profile[key]}
        onChange={(e) => setProfile({ ...profile, [key]: e.target.value })}
      />
    </label>
  );

  return (
    <AccountPageShell title="My Profile" description="Manage your account details and password.">
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="panel">
          <h2 className="text-lg font-semibold mb-4">Account details</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {field("First name", "firstName")}
            {field("Last name", "lastName")}
            {field("Email", "email", "email")}
            {field("Phone", "phone", "tel")}
            {field("Department", "department")}
            {field("Title", "title")}
          </div>
          <div className="flex items-center gap-3 mt-5">
            <button className="btn btn-primary" onClick={save}><Save className="h-4 w-4" />Save changes</button>
            {saved && <span className="text-xs text-muted-foreground">{saved}</span>}
          </div>
        </section>
        <section className="panel">
          <h2 className="text-lg font-semibold mb-4">Change password</h2>
          <div className="grid gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Current password</span>
              <input className="glass-input" type="password" value={password.current} onChange={(e) => setPassword({ ...password, current: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">New password</span>
              <input className="glass-input" type="password" value={password.next} onChange={(e) => setPassword({ ...password, next: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Confirm new password</span>
              <input className="glass-input" type="password" value={password.confirm} onChange={(e) => setPassword({ ...password, confirm: e.target.value })} />
            </label>
          </div>
          <div className="mt-5">
            <button className="btn btn-primary" onClick={changePassword}><Save className="h-4 w-4" />Update password</button>
          </div>
        </section>
      </div>
    </AccountPageShell>
  );
}
