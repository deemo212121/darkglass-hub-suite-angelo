import { createFileRoute, useNavigate, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import logo from "@/assets/logo.png";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { LayoutDashboard, Package, Ticket, FileBarChart, Users, ShieldCheck, ArrowRight } from "lucide-react";

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
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-background/40 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Admin Hub Solutions" className="h-9 w-9 object-contain" />
            <span className="font-display font-semibold text-lg">Admin Hub Solutions</span>
          </div>
          <nav className="flex items-center gap-6">
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground hidden sm:inline">Features</a>
            <a href="#modules" className="text-sm text-muted-foreground hover:text-foreground hidden sm:inline">Modules</a>
            <a href="#contact" className="text-sm text-muted-foreground hover:text-foreground hidden sm:inline">Contact</a>
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

      {/* Modules grid */}
      <section id="modules" className="max-w-6xl mx-auto px-6 pb-24">
        <div className="text-center mb-12">
          <h2 className="font-display text-3xl sm:text-4xl font-semibold">Everything you need, in one place</h2>
          <p className="mt-3 text-muted-foreground">Six integrated modules to run your entire operation.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { icon: LayoutDashboard, t: "Dashboard", d: "Real-time activity, KPIs, and system status at a glance." },
            { icon: Package, t: "Parts", d: "Track inventory, returns, vendors, and warranty across the supply chain." },
            { icon: Ticket, t: "Tickets", d: "Dispatch, schedule, and resolve service tickets end-to-end." },
            { icon: FileBarChart, t: "Claims", d: "Submit, track, and approve claims with full audit history." },
            { icon: Users, t: "Reports", d: "Inventory, sales, performance — exportable on demand." },
            { icon: ShieldCheck, t: "Admin", d: "Users, roles, settings, and a complete audit trail." },
          ].map((m) => (
            <div key={m.t} className="panel hover:border-primary/40 transition-colors">
              <div className="h-10 w-10 rounded-md bg-primary/15 text-primary flex items-center justify-center">
                <m.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-display font-semibold text-lg">{m.t}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{m.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer id="contact" className="border-t border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} Admin Hub Solutions</span>
          <span>Demo build — data stored locally in your browser.</span>
        </div>
      </footer>

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
              <input className="glass-input mt-1" type="email" autoComplete="email"
                value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground text-xs">Password</span>
              <input className="glass-input mt-1" type="password" autoComplete="current-password"
                value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground text-xs">Company ID</span>
              <input className="glass-input mt-1" value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })} />
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
