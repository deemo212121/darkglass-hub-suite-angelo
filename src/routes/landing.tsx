import { createFileRoute, useNavigate, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import logo from "@/assets/logo.png";

export const Route = createFileRoute("/landing")({
  head: () => ({ meta: [{ title: "Sign in — Admin Hub Solutions" }] }),
  component: Landing,
});

function Landing() {
  const { login, email, ready } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "", company: "4930403", remember: true });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (form.remember) {
      const last = localStorage.getItem("ahs:lastEmail");
      if (last) setForm((f) => ({ ...f, email: last }));
    }
  }, [form.remember]);

  if (ready && email) return <Navigate to="/home" />;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.password) { setErr("Email and password are required."); return; }
    if (form.remember) localStorage.setItem("ahs:lastEmail", form.email);
    login(form.email, form.company);
    navigate({ to: "/home" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <img src={logo} alt="Admin Hub Solutions" className="h-20 w-20 object-contain" />
          <h1 className="mt-3 text-2xl font-display font-semibold">Admin Hub Solutions</h1>
          <p className="text-sm text-muted-foreground">Sign in to your operations console</p>
        </div>
        <form className="panel" onSubmit={submit}>
          <label className="block text-sm mb-3">
            <span className="text-muted-foreground text-xs">Email</span>
            <input className="glass-input mt-1" type="email" autoComplete="email"
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="block text-sm mb-3">
            <span className="text-muted-foreground text-xs">Password</span>
            <input className="glass-input mt-1" type="password" autoComplete="current-password"
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
          <label className="block text-sm mb-3">
            <span className="text-muted-foreground text-xs">Company ID</span>
            <input className="glass-input mt-1" value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })} />
          </label>
          <label className="flex items-center gap-2 text-sm mb-4">
            <input type="checkbox" checked={form.remember} onChange={(e) => setForm({ ...form, remember: e.target.checked })} />
            Remember me
          </label>
          {err && <div className="text-sm text-destructive mb-3">{err}</div>}
          <button type="submit" className="btn btn-primary w-full justify-center">Sign in</button>
          <p className="text-xs text-muted-foreground mt-3 text-center">
            Demo only — any email/password works. Data is stored locally.
          </p>
        </form>
      </div>
    </div>
  );
}
