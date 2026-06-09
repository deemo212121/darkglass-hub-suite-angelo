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

const DEFAULT_LOGIN_EMAILS = [
  // Admin/Standard Testing Accounts
  "admin@ahsolutions.com",
  "manager@ahsolutions.com",
  "tech@ahsolutions.com",
  "viewer@ahsolutions.com",
  "superadmin@ahsolutions.com",
  "finance@ahsolutions.com",
  "csr@ahsolutions.com",
  "hr@ahsolutions.com",
  "parts@ahsolutions.com",
  
  // US Employees (5)
  "john.richardson@ahsolutions.com",
  "sarah.mitchell@ahsolutions.com",
  "michael.chen@ahsolutions.com",
  "emily.watson@ahsolutions.com",
  "david.rodriguez@ahsolutions.com",
  
  // Philippines Employees (5)
  "maria.santos@ahsolutions.com.ph",
  "juan.delacruz@ahsolutions.com.ph",
  "anna.reyes@ahsolutions.com.ph",
  "carlos.gutierrez@ahsolutions.com.ph",
  "rosa.morales@ahsolutions.com.ph",
];

export const Route = createFileRoute("/landing")({
  head: () => ({ meta: [{ title: "Sign in — Admin Hub Solutions" }] }),
  component: Landing,
});

function Landing() {
  const { login, email, ready } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: DEFAULT_LOGIN_EMAILS[0], password: "", company: "4930403", remember: true });
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [emailOptions, setEmailOptions] = useState<string[]>(DEFAULT_LOGIN_EMAILS);

  useEffect(() => {
    if (form.remember) {
      const last = localStorage.getItem("ahs:lastEmail");
      if (last) setForm((f) => ({ ...f, email: last }));
    }
  }, [form.remember]); // Only depends on form.remember, not entire form

  useEffect(() => {
    let active = true;
    getUsers()
      .then((users) => {
        if (!active) return;
        const savedEmail = localStorage.getItem("ahs:lastEmail");
        const nextOptions = Array.from(
          new Set([
            ...DEFAULT_LOGIN_EMAILS,
            ...users.map((user) => user.email).filter(Boolean),
            savedEmail,
          ].filter((value): value is string => Boolean(value)))
        ).sort((a, b) => a.localeCompare(b));
        setEmailOptions(nextOptions);
        setForm((current) => ({
          ...current,
          email: current.email || savedEmail || nextOptions[0] || DEFAULT_LOGIN_EMAILS[0],
        }));
      })
      .catch(() => setEmailOptions(DEFAULT_LOGIN_EMAILS));

    return () => {
      active = false;
    };
  }, []);

  if (ready && email) return <Navigate to="/home" replace />;

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
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm">
              <span className="text-muted-foreground text-xs font-semibold uppercase">Email</span>
              <p className="text-muted-foreground text-xs mt-1 mb-2">
                📧 Select a test account. Employee emails are preloaded with full data for testing.
              </p>
              <Select value={form.email} onValueChange={(value) => setForm({ ...form, email: value })}>
                <SelectTrigger className="glass-input mt-1 w-full">
                  <SelectValue placeholder="Select email" />
                </SelectTrigger>
                <SelectContent>
                  {/* Admin Accounts */}
                  <div className="px-2 py-1.5 text-xs text-slate-400 font-semibold">Admin Accounts</div>
                  {["admin@ahsolutions.com", "manager@ahsolutions.com", "tech@ahsolutions.com", "viewer@ahsolutions.com", "superadmin@ahsolutions.com", "finance@ahsolutions.com", "csr@ahsolutions.com", "hr@ahsolutions.com", "parts@ahsolutions.com"].map((option) => (
                    <SelectItem key={option} value={option}>{option}</SelectItem>
                  ))}
                  
                  {/* US Employees */}
                  <div className="px-2 py-1.5 text-xs text-slate-400 font-semibold">US Employees</div>
                  {["john.richardson@ahsolutions.com", "sarah.mitchell@ahsolutions.com", "michael.chen@ahsolutions.com", "emily.watson@ahsolutions.com", "david.rodriguez@ahsolutions.com"].map((option) => (
                    <SelectItem key={option} value={option}>{option}</SelectItem>
                  ))}
                  
                  {/* Philippines Employees */}
                  <div className="px-2 py-1.5 text-xs text-slate-400 font-semibold">Philippines Employees</div>
                  {["maria.santos@ahsolutions.com.ph", "juan.delacruz@ahsolutions.com.ph", "anna.reyes@ahsolutions.com.ph", "carlos.gutierrez@ahsolutions.com.ph", "rosa.morales@ahsolutions.com.ph"].map((option) => (
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
            <div className="space-y-2 bg-blue-500/10 border border-blue-500/30 rounded p-3 text-xs text-blue-200">
              <p className="font-semibold">🧪 Testing Notes:</p>
              <ul className="space-y-1 ml-2">
                <li>• Any password works for demo</li>
                <li>• Employee emails (10 accounts) have full preloaded data</li>
                <li>• Each account shows personalized timecards, payroll, attendance</li>
                <li>• Test cross-module data flow with different employee accounts</li>
              </ul>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
