import { createFileRoute, useNavigate, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import logo from "@/assets/Admin Hub Solutions Logo no Text.png";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Footer } from "@/components/Footer";
import { ArrowRight } from "lucide-react";
import { getUsers } from "@/lib/db-api";
import { LOGIN_COMPANY_OPTIONS } from "@/lib/modules";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/landing")({
  head: () => ({ meta: [{ title: "Sign in — Admin Hub Solutions" }] }),
  component: Landing,
});

function Landing() {
  const { login, email, ready } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "", company: "4930403", remember: true });
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [emailOptions, setEmailOptions] = useState<string[]>([]);

  useEffect(() => {
    if (form.remember) {
      const last = localStorage.getItem("ahs:lastEmail");
      if (last) setForm((f) => ({ ...f, email: last }));
    }
  }, [form.remember]);

  useEffect(() => {
    let active = true;
    getUsers()
      .then((users) => {
        if (!active) return;
        const savedEmail = localStorage.getItem("ahs:lastEmail");
        const nextOptions = Array.from(
          new Set([
            ...users.map((user) => user.email).filter(Boolean),
            savedEmail,
          ].filter((value): value is string => Boolean(value)))
        ).sort((a, b) => a.localeCompare(b));
        setEmailOptions(nextOptions);
        setForm((current) => ({
          ...current,
          email: current.email || nextOptions[0] || "",
        }));
      })
      .catch(() => setEmailOptions((current) => current));

    return () => {
      active = false;
    };
  }, []);

  if (ready && email) return <Navigate to="/home" />;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.password) { setErr("Email and password are required."); return; }
    if (form.remember) localStorage.setItem("ahs:lastEmail", form.email);
    login(form.email, form.company);
    navigate({ to: "/home" });
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-background/40 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Admin Hub Solutions" className="h-9 w-9 object-contain" />
            <span className="font-display font-semibold text-lg">Admin Hub Solutions</span>
          </div>
          <nav className="flex items-center gap-3">
            <button onClick={() => setOpen(true)} className="btn btn-primary">Login</button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="max-w-5xl mx-auto px-6 pt-20 pb-28 text-center">
          <img src={logo} alt="" className="h-24 w-24 mx-auto object-contain drop-shadow-2xl" />
          <h1 className="mt-8 font-display font-bold tracking-tight text-5xl sm:text-7xl">
            Admin Hub Solutions
          </h1>
          <p className="mt-6 text-xl sm:text-2xl text-foreground/90">
            Comprehensive Enterprise Administration Solution
          </p>
          <p className="mt-4 max-w-2xl mx-auto text-muted-foreground">
            A complete suite of administrative management tools designed to streamline operations,
            enhance productivity, and deliver superior service management capabilities.
          </p>
          <div className="mt-10 flex items-center justify-center gap-3">
            <button onClick={() => setOpen(true)} className="btn btn-primary text-base px-8 py-3 inline-flex items-center gap-2">
              Get Started — Login Now <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>



      <Footer />

      {/* Login Modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card border-white/10">
          <DialogHeader>
            <DialogTitle className="font-display">Sign in</DialogTitle>
            <DialogDescription>Access your Admin Hub operations console.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <label className="block text-sm">
              <span className="text-muted-foreground text-xs">Email</span>
              <Select value={form.email} onValueChange={(value) => setForm({ ...form, email: value })}>
                <SelectTrigger className="glass-input mt-1 w-full">
                  <SelectValue placeholder={emailOptions.length ? "Select email" : "No accounts loaded"} />
                </SelectTrigger>
                <SelectContent>
                  {emailOptions.map((option) => (
                    <SelectItem key={option} value={option}>{option}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground text-xs">Password</span>
              <input className="glass-input mt-1" type="password" autoComplete="current-password"
                value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground text-xs">Company ID</span>
              <Select value={form.company} onValueChange={(value) => setForm({ ...form, company: value })}>
                <SelectTrigger className="glass-input mt-1 w-full">
                  <SelectValue placeholder="Select company ID" />
                </SelectTrigger>
                <SelectContent>
                  {LOGIN_COMPANY_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>{option}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.remember} onChange={(e) => setForm({ ...form, remember: e.target.checked })} />
              Remember me
            </label>
            {err && <div className="text-sm text-destructive">{err}</div>}
            <button type="submit" className="btn btn-primary w-full justify-center">Sign in</button>
            <p className="text-xs text-muted-foreground text-center">
              Demo only — any email/password works.
            </p>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
