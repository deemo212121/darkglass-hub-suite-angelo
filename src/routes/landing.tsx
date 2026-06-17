import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import logo from "@/assets/Admin Hub Solutions Logo no Text.png";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Footer } from "@/components/Footer";
import { ArrowRight } from "lucide-react";

export const Route = createFileRoute("/landing")({
  head: () => ({ meta: [{ title: "Sign in — Admin Hub Solutions" }] }),
  component: Landing,
});

function Landing() {
  const { login, logout, email, role, ready, loading, companyId } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ 
    emailOrUsername: "jdage7@gmail.com", 
    password: "", 
    company: "COMP001",
    remember: true 
  });
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // The company ID the user typed at login, validated reactively once the auth
  // context finishes loading the profile (avoids the race of re-querying with a
  // fixed delay). Cleared after a successful validation.
  const [pendingCompany, setPendingCompany] = useState<string | null>(null);

  useEffect(() => {
    if (form.remember) {
      const last = localStorage.getItem("ahs:lastEmailOrUsername");
      const lastCompany = localStorage.getItem("ahs:lastCompany");
      if (last) setForm((f) => ({ ...f, emailOrUsername: last }));
      if (lastCompany) setForm((f) => ({ ...f, company: lastCompany }));
    }
  }, [form.remember]);

  // Redirect based on role after login
  useEffect(() => {
    // Don't redirect while a company validation is still pending.
    if (pendingCompany) return;
    if (ready && email && role) {
      // Don't redirect if we're not on the landing page anymore
      if (typeof window !== 'undefined' && window.location.pathname !== '/landing') {
        return;
      }
      
      // SUPERADMIN goes to superadmin dashboard
      if (role.toUpperCase() === "SUPERADMIN") {
        navigate({ to: "/superadmin", replace: true });
      } else {
        // All other roles go to home
        navigate({ to: "/home", replace: true });
      }
    }
  }, [ready, email, role, navigate, pendingCompany]);

  // Validate the typed company ID against the profile's company once the auth
  // context has finished loading it. This is event-driven (no fixed delay), so
  // it can't misfire from a session that isn't ready yet.
  useEffect(() => {
    if (!pendingCompany) return;
    // Wait until the auth listener has loaded a profile (email + companyId set).
    if (!ready || !email) return;
    // companyId may be "" if the company join returned nothing — treat empty as
    // "can't verify" and allow through (don't log a valid user out).
    if (companyId && companyId.toUpperCase() !== pendingCompany.toUpperCase()) {
      setErr("Invalid company ID for this account.");
      setPendingCompany(null);
      setSubmitting(false);
      void logout();
      return;
    }
    // Validated (or unverifiable) — let the redirect effect proceed.
    setPendingCompany(null);
    setSubmitting(false);
  }, [pendingCompany, ready, email, companyId, logout]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!form.emailOrUsername || !form.password) { 
      setErr("Email/Username and password are required."); 
      return; 
    }

    if (!form.company) {
      setErr("Company ID is required.");
      return;
    }

    setSubmitting(true);
    setErr(null);

    try {
      // Determine if input is email or username
      const isEmail = form.emailOrUsername.includes('@');
      
      let userEmail = form.emailOrUsername;
      
      if (!isEmail) {
        // It's a username - look up the email from Supabase first.
        const { getUserByUsername } = await import("@/lib/supabase/users");
        const user = await getUserByUsername(form.emailOrUsername, form.company);
        
        if (!user) {
          setErr(`User "${form.emailOrUsername}" not found in company ${form.company}`);
          setSubmitting(false);
          return;
        }
        
        userEmail = user.email;
      }
      
      // Login with email. The auth listener (auth.tsx) loads the profile from
      // Supabase and populates the auth context (email, role, companyId). We
      // then validate the typed company ID reactively via the effect above —
      // no fragile fixed delay, no redundant re-query.
      await login(userEmail, form.password);

      // Save credentials if remember is checked
      if (form.remember) {
        localStorage.setItem("ahs:lastEmailOrUsername", form.emailOrUsername);
        localStorage.setItem("ahs:lastCompany", form.company);
      }

      // Hand off to the validation effect; keep the button in "submitting"
      // state until it resolves (it clears submitting + pendingCompany).
      setPendingCompany(form.company);

      // Navigation will happen automatically via useEffect once validated.
    } catch (error: any) {
      console.error("Login error:", error);
      setErr(error.message || "Login failed. Please check your credentials.");
      setSubmitting(false);
    }
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
            <DialogDescription>Access your Admin Hub operations console with Firebase Authentication.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm">
              <span className="text-muted-foreground text-xs font-semibold uppercase">Email or Username</span>
              <input 
                className="glass-input mt-1 w-full" 
                type="text" 
                autoComplete="username"
                value={form.emailOrUsername} 
                onChange={(e) => setForm({ ...form, emailOrUsername: e.target.value })}
                placeholder="your.email@company.com or FirstName.LastName"
                disabled={submitting}
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground text-xs font-semibold uppercase">Password</span>
              <input 
                className="glass-input mt-1 w-full" 
                type="password" 
                autoComplete="current-password"
                value={form.password} 
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="••••••••"
                disabled={submitting}
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground text-xs font-semibold uppercase">Company ID</span>
              <input 
                className="glass-input mt-1 w-full" 
                type="text" 
                autoComplete="organization"
                value={form.company} 
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                placeholder="4930403"
                disabled={submitting}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input 
                type="checkbox" 
                checked={form.remember} 
                onChange={(e) => setForm({ ...form, remember: e.target.checked })}
                disabled={submitting}
              />
              Remember my credentials
            </label>
            {err && (
              <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded p-3">
                {err}
              </div>
            )}
            <button 
              type="submit" 
              className="btn btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={submitting || loading}
            >
              {submitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
