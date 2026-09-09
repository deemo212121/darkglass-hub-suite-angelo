import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import logo from "@/assets/Admin Hub Solutions Logo no Text.png";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Footer } from "@/components/Footer";
import { LiveChatWidget } from "@/components/LiveChatWidget";
import { Eye, EyeOff, Ticket, Wrench, Users, ClipboardList, BarChart3, ShieldCheck, X } from "lucide-react";

// Decorative floating module icons on the brand side — purely visual, each
// one drifts on its own offset loop (see .ahs-float below) so they don't
// all bob in lockstep. The text block uses max-w-md, well short of the
// column's full width, so a vertical strip hugging the column's right edge
// (right: 4%/20%, alternating) stays clear of the headline/paragraph/tags
// at every viewport this column can appear at.
const FLOATING_ICONS = [
  { Icon: Ticket, style: { top: "3%", right: "4%" }, delay: "0s", duration: "7s" },
  { Icon: Wrench, style: { top: "18%", right: "20%" }, delay: "1.1s", duration: "8s" },
  { Icon: Users, style: { top: "34%", right: "4%" }, delay: "0.6s", duration: "6.5s" },
  { Icon: ClipboardList, style: { top: "50%", right: "20%" }, delay: "1.8s", duration: "7.5s" },
  { Icon: BarChart3, style: { top: "65%", right: "4%" }, delay: "2.4s", duration: "9s" },
  { Icon: ShieldCheck, style: { top: "80%", right: "20%" }, delay: "3.1s", duration: "7s" },
] as const;

export const Route = createFileRoute("/landing")({
  head: () => ({ meta: [{ title: "Sign in — Admin Hub Solutions" }] }),
  component: Landing,
});

function Landing() {
  const { login, logout, email, role, ready, loading, companyId, companyLoginAlias } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ 
    emailOrUsername: "jdage7@gmail.com", 
    password: "", 
    company: "USIHS",
    remember: true 
  });
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Below lg, the sign-in card lives behind a "Login" button instead of
  // always inline — this is that bottom sheet's open state.
  const [mobileSignInOpen, setMobileSignInOpen] = useState(false);
  // "Forgot password?" — there's no self-service email reset in this app;
  // this just queues a request for IT/HR to see and follow up on directly
  // (see LoginSecurityPage.tsx's "Password Reset Requests" tab).
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotForm, setForgotForm] = useState({ fullName: "", username: "", email: "" });
  const [forgotSubmitting, setForgotSubmitting] = useState(false);

  // The landing page always shows the light theme, regardless of whatever
  // dark/light preference the visitor has stored (lib/theme.tsx persists
  // that to localStorage globally) — this only touches the <html> attribute
  // directly while mounted here, restoring whatever it was on the way out,
  // so logging in and landing on /home still respects the user's own real
  // preference instead of silently overwriting it just because they passed
  // through this page.
  //
  // A plain one-shot mount effect isn't enough: ThemeProvider (an ancestor,
  // in __root.tsx) has its OWN mount effect that re-applies whatever's
  // saved in localStorage — since React fires child effects before parent
  // effects, a visitor with a saved "dark" preference would have THIS
  // effect run first, then ThemeProvider's effect immediately overwrite it
  // back to dark. That leaves dark-mode text colors (near-white
  // foreground) rendering against this page's own hardcoded white
  // background — exactly the invisible-text bug this MutationObserver
  // closes: it re-asserts "light" the instant anything else changes the
  // attribute, for as long as this page stays mounted, regardless of which
  // effect fires first.
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.getAttribute("data-theme");
    const forceLight = () => {
      if (root.getAttribute("data-theme") !== "light") root.setAttribute("data-theme", "light");
    };
    forceLight();
    const observer = new MutationObserver(forceLight);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      observer.disconnect();
      if (prev) root.setAttribute("data-theme", prev);
      else root.removeAttribute("data-theme");
    };
  }, []);
  const [forgotMsg, setForgotMsg] = useState<{ text: string; error?: boolean } | null>(null);
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
      
      // Only the platform-level SUPERSUPERADMIN goes to the superadmin
      // console — the per-company SUPERADMIN role goes to /home like ADMIN.
      if (role.toUpperCase() === "SUPERSUPERADMIN") {
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
    // "can't verify" and allow through (don't log a valid user out). Once a
    // company has a login alias set (see migration 0066, 0085), that's the
    // only value accepted here — the canonical company ID only still works
    // for companies with no alias configured.
    const typed = pendingCompany.toUpperCase();
    const matches = companyLoginAlias
      ? companyLoginAlias.toUpperCase() === typed
      : companyId
        ? companyId.toUpperCase() === typed
        : false;
    if (companyId && !matches) {
      setErr("Invalid company ID for this account.");
      setSubmitting(false);
      // Keep pendingCompany set until sign-out actually completes — the
      // redirect effect below only bails out while pendingCompany is
      // truthy, and Firebase's signOut + the auth listener clearing
      // email/role happen asynchronously. Clearing it immediately (as
      // this used to) let the redirect effect see the still-valid
      // email/role from the old session for one render and navigate to
      // /home before sign-out landed - i.e. rejecting a company ID
      // silently still logged the user in.
      logout().finally(() => setPendingCompany(null));
      return;
    }
    // Validated (or unverifiable) — let the redirect effect proceed.
    setPendingCompany(null);
    setSubmitting(false);
  }, [pendingCompany, ready, email, companyId, companyLoginAlias, logout]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!form.emailOrUsername || !form.password) { 
      setErr("Email/Username and password are required."); 
      return; 
    }

    if (!form.company) {
      setErr("Unique ID is required.");
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
        const { getUserByUsername, isValidCompanyCode } = await import("@/lib/supabase/users");
        const user = await getUserByUsername(form.emailOrUsername, form.company);

        if (!user) {
          // Distinguish "wrong company code" from "wrong username" instead
          // of always blaming the username — a common case is typing a
          // company's old legacy code after it's switched to alias-only.
          const companyOk = await isValidCompanyCode(form.company);
          setErr(
            companyOk
              ? `User "${form.emailOrUsername}" not found in company ${form.company}`
              : `Unique ID "${form.company}" is incorrect.`
          );
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
      const message = error.message || "Login failed. Please check your credentials.";
      // A failed login can leave this tab's in-memory auth state tangled
      // (e.g. a stale sign-out call racing a fresh one — see auth.tsx's
      // checkAndHandleSession) — a full reload guarantees the next attempt
      // starts from clean state instead of retrying on top of whatever
      // broke. Stash the message first so it still shows once the reload lands.
      sessionStorage.setItem("ahs:loginErrorAfterReload", message);
      window.location.reload();
    }
  };

  const submitForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotForm.fullName.trim() || !forgotForm.username.trim()) {
      setForgotMsg({ text: "Full name and username are required.", error: true });
      return;
    }
    setForgotSubmitting(true);
    setForgotMsg(null);
    try {
      const res = await fetch("/api/password-reset-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(forgotForm),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setForgotMsg({ text: data.error || "Failed to submit request.", error: true });
        return;
      }
      setForgotMsg({ text: "Request submitted — IT has been notified and will reach out to you shortly." });
      setForgotForm({ fullName: "", username: "", email: "" });
    } catch (error: any) {
      setForgotMsg({ text: error.message || "Failed to submit request.", error: true });
    } finally {
      setForgotSubmitting(false);
    }
  };

  // Restore the error message stashed right before the reload above, so it
  // isn't lost — read once and clear it so it doesn't reappear on a later,
  // unrelated reload.
  useEffect(() => {
    const pending = sessionStorage.getItem("ahs:loginErrorAfterReload");
    if (pending) {
      setErr(pending);
      sessionStorage.removeItem("ahs:loginErrorAfterReload");
    }
  }, []);

  // Shared between the always-visible desktop card and the mobile bottom
  // sheet, so the two shells around it can't drift out of sync.
  const signInFields = (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <label className="block text-sm">
        <span className="text-muted-foreground text-xs font-semibold uppercase">Username</span>
        <input
          className="glass-input mt-1 w-full"
          type="text"
          autoComplete="username"
          value={form.emailOrUsername}
          onChange={(e) => setForm({ ...form, emailOrUsername: e.target.value })}
          placeholder="Username"
          disabled={submitting}
        />
      </label>
      <label className="block text-sm">
        <span className="text-muted-foreground text-xs font-semibold uppercase">Password</span>
        <div className="relative mt-1">
          <input
            className="glass-input w-full pr-10"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="••••••••"
            disabled={submitting}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            tabIndex={-1}
            title={showPassword ? "Hide password" : "Show password"}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </label>
      <label className="block text-sm">
        <span className="text-muted-foreground text-xs font-semibold uppercase">Unique ID</span>
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
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.remember}
            onChange={(e) => setForm({ ...form, remember: e.target.checked })}
            disabled={submitting}
          />
          Remember my credentials
        </label>
        <button
          type="button"
          onClick={() => { setMobileSignInOpen(false); setForgotOpen(true); }}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          Forgot password?
        </button>
      </div>
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
  );

  return (
    // flex-col + the hero section's own flex-1 below pins the footer to the
    // very bottom of the viewport on short content — the same effect
    // body > main { flex: 1 0 auto } gives every other (chrome-visible)
    // page, replicated locally since /landing renders with hideChrome
    // (__root.tsx), so there's no <main> wrapper here to hang that rule off.
    //
    // relative + overflow-hidden live HERE (the whole page), not on the
    // hero <section> — the orbs below are children of this root, so they
    // paint continuously behind the header and footer too, with no section
    // boundary to hard-clip against. Header/footer both stay fully
    // transparent (no background of their own), so they read as the exact
    // same surface as the hero instead of a seam anywhere.
    // bg-white overrides body's own (warm cream) light-theme background —
    // that cream tone is the shared app-wide light palette, but this page
    // wants a cleaner white base with dark blue only as an accent (logo,
    // buttons, subtle orb glows), not a dominant tint.
    <div className="relative overflow-hidden min-h-screen flex flex-col bg-white">
      {/* Ambient drifting gradient orbs — behind the whole page, not just
          the hero section, so nothing clips them mid-page. */}
      <div aria-hidden className="ahs-orb ahs-orb-1" />
      <div aria-hidden className="ahs-orb ahs-orb-2" />

      {/* Header — minimal, just the mark. There's no separate "Login" entry
          point anymore since the sign-in card is always visible below. */}
      <header id="ahs-landing-header" className="relative z-20">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Admin Hub Solutions" className="h-9 w-9 object-contain" />
            <span className="font-display font-semibold text-lg">Admin Hub Solutions</span>
          </div>
        </div>
      </header>

      {/* Hero — split layout (brand story on the left, sign-in card on the
          right), the way a Facebook/Google-style login page reads. Stacks
          to a single column below lg. */}
      <section className="relative flex-1 flex flex-col justify-center">

        <div className="relative max-w-7xl mx-auto px-6 pt-8 pb-20 lg:pt-16 lg:pb-28 grid grid-cols-1 lg:grid-cols-2 gap-14 lg:gap-10 items-center">
          {/* Left: brand story */}
          <div className="relative ahs-enter-left">
            {/* Floating module icons — decorative, hidden on small screens
                where there's no room for them not to collide with text. */}
            <div aria-hidden className="hidden lg:block absolute inset-0 pointer-events-none">
              {FLOATING_ICONS.map(({ Icon, style, delay, duration }, i) => (
                <div
                  key={i}
                  className="ahs-float absolute h-11 w-11 rounded-xl bg-white/[0.06] border border-white/10 backdrop-blur-md flex items-center justify-center text-primary/80 shadow-lg"
                  style={{ ...style, animationDelay: delay, animationDuration: duration }}
                >
                  <Icon className="h-5 w-5" />
                </div>
              ))}
            </div>

            <img id="ahs-landing-hero-logo" src={logo} alt="" className="h-16 w-16 object-contain drop-shadow-2xl" />
            <h1 className="mt-6 font-display font-bold tracking-tight text-4xl sm:text-5xl xl:text-6xl">
              Admin Hub Solutions
            </h1>
            <p className="mt-5 text-lg sm:text-xl text-foreground/90 max-w-md">
              Comprehensive Enterprise Administration Solution
            </p>
            <p className="mt-4 max-w-md text-muted-foreground">
              A complete suite of administrative management tools designed to streamline operations,
              enhance productivity, and deliver superior service management capabilities.
            </p>
            <ul className="mt-8 flex flex-wrap gap-2">
              {["Ticketing", "Parts & Inventory", "Payroll & HR", "Reporting"].map((label) => (
                <li
                  key={label}
                  className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/10 text-foreground/80"
                >
                  {label}
                </li>
              ))}
            </ul>
          </div>

          {/* Right: sign-in card — always visible on lg+ (the split-layout
              point of this whole redesign). Below lg, showing the full
              card inline pushes it a long scroll below the brand content,
              so a compact "Login" button opens the same form as a bottom
              sheet instead — same form markup either way (signInFields
              below), just two different shells around it. */}
          <div id="signin" className="ahs-enter-right">
            <div className="hidden lg:block relative mx-auto w-full max-w-md">
              <div className="ahs-card-glow" aria-hidden />
              <div className="relative panel !mb-0 !p-7 sm:!p-8">
                <h2 className="font-display text-xl font-semibold">Sign in</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Access your Admin Hub operations console.
                </p>
                {signInFields}
              </div>
            </div>

            <div className="lg:hidden">
              <button
                type="button"
                onClick={() => setMobileSignInOpen(true)}
                className="btn btn-primary w-full justify-center text-base py-3"
              >
                Login
              </button>
            </div>

            <p className="mt-5 text-center text-xs text-muted-foreground">
              Don't have an account? Contact your company admin or IT.
            </p>
          </div>
        </div>
      </section>

      {/* Mobile sign-in bottom sheet — same form as the desktop card, just
          tucked behind the "Login" button below lg so the page itself
          reads short (brand content, then one button) instead of always
          showing the full form inline. */}
      {mobileSignInOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 flex items-end"
          onClick={() => setMobileSignInOpen(false)}
        >
          <div className="absolute inset-0 bg-black/40" aria-hidden />
          <div
            onClick={(e) => e.stopPropagation()}
            className="ahs-sheet-enter relative w-full bg-card rounded-t-2xl p-6 pb-8 max-h-[85vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-display text-xl font-semibold">Sign in</h2>
              <button
                type="button"
                onClick={() => setMobileSignInOpen(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              Access your Admin Hub operations console.
            </p>
            {signInFields}
          </div>
        </div>
      )}

      <Footer />

      <LiveChatWidget />

      {/* Forgot Password Modal — no self-service email reset in this app;
          this just queues a request for IT/HR to see and follow up on
          directly, see LoginSecurityPage.tsx's "Password Reset Requests" tab. */}
      <Dialog open={forgotOpen} onOpenChange={(v) => { setForgotOpen(v); if (!v) setForgotMsg(null); }}>
        <DialogContent className="bg-card border-white/10">
          <DialogHeader>
            <DialogTitle className="font-display">Forgot Password</DialogTitle>
            <DialogDescription>
              Submit your details and IT will reach out to help reset your password.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitForgotPassword} className="space-y-4">
            <div className="text-xs text-blue-300 bg-blue-500/10 border border-blue-500/30 rounded p-3">
              This creates an IT support ticket under your name — IT will be notified immediately and will contact you to reset your password.
            </div>
            <label className="block text-sm">
              <span className="text-muted-foreground text-xs font-semibold uppercase">Full Name</span>
              <input
                className="glass-input mt-1 w-full"
                type="text"
                value={forgotForm.fullName}
                onChange={(e) => setForgotForm({ ...forgotForm, fullName: e.target.value })}
                placeholder="Your full name"
                disabled={forgotSubmitting}
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground text-xs font-semibold uppercase">Account Username</span>
              <input
                className="glass-input mt-1 w-full"
                type="text"
                value={forgotForm.username}
                onChange={(e) => setForgotForm({ ...forgotForm, username: e.target.value })}
                placeholder="Your login username"
                disabled={forgotSubmitting}
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground text-xs font-semibold uppercase">Email</span>
              <input
                className="glass-input mt-1 w-full"
                type="email"
                value={forgotForm.email}
                onChange={(e) => setForgotForm({ ...forgotForm, email: e.target.value })}
                placeholder="you@example.com"
                disabled={forgotSubmitting}
              />
            </label>
            {forgotMsg && (
              <div
                className={`text-sm rounded p-3 border ${
                  forgotMsg.error
                    ? "text-red-400 bg-red-500/10 border-red-500/30"
                    : "text-emerald-300 bg-emerald-500/10 border-emerald-500/30"
                }`}
              >
                {forgotMsg.text}
              </div>
            )}
            <button
              type="submit"
              className="btn btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={forgotSubmitting}
            >
              {forgotSubmitting ? "Submitting..." : "Submit Request"}
            </button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Scoped to this page — kept local instead of the shared stylesheet
          since nothing else needs these. Respects prefers-reduced-motion,
          same convention the app's own .page-fade-in already uses. */}
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          @keyframes ahs-float {
            0%, 100% { transform: translateY(0) rotate(0deg); }
            50% { transform: translateY(-14px) rotate(4deg); }
          }
          .ahs-float { animation: ahs-float 7s ease-in-out infinite; }

          @keyframes ahs-orb-drift {
            0% { transform: translate(0, 0) scale(1); }
            50% { transform: translate(4%, -6%) scale(1.08); }
            100% { transform: translate(-3%, 4%) scale(0.96); }
          }
          .ahs-orb-1, .ahs-orb-2 { animation: ahs-orb-drift 16s ease-in-out infinite alternate; }

          @keyframes ahs-enter-left {
            from { opacity: 0; transform: translateX(-24px); }
            to { opacity: 1; transform: translateX(0); }
          }
          .ahs-enter-left { animation: ahs-enter-left 0.6s cubic-bezier(0.4, 0, 0.2, 1) both; }

          @keyframes ahs-enter-right {
            from { opacity: 0; transform: translateX(24px); }
            to { opacity: 1; transform: translateX(0); }
          }
          .ahs-enter-right { animation: ahs-enter-right 0.6s 0.12s cubic-bezier(0.4, 0, 0.2, 1) both; }

          @keyframes ahs-sheet-enter {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
          }
          .ahs-sheet-enter { animation: ahs-sheet-enter 0.28s cubic-bezier(0.4, 0, 0.2, 1) both; }

          @keyframes ahs-card-glow-pulse {
            0%, 100% { opacity: 0.55; }
            50% { opacity: 0.9; }
          }
          .ahs-card-glow { animation: ahs-card-glow-pulse 5s ease-in-out infinite; }
        }

        .ahs-orb {
          position: absolute;
          border-radius: 9999px;
          filter: blur(90px);
          pointer-events: none;
          z-index: 0;
        }
        .ahs-orb-1 {
          top: -10%;
          left: -6%;
          width: 34rem;
          height: 34rem;
          background: radial-gradient(circle, oklch(0.55 0.2 255 / 0.16), transparent 70%);
        }
        .ahs-orb-2 {
          bottom: -14%;
          right: -8%;
          width: 30rem;
          height: 30rem;
          background: radial-gradient(circle, oklch(0.6 0.18 300 / 0.12), transparent 70%);
        }

        .ahs-card-glow {
          position: absolute;
          inset: -1.5rem;
          border-radius: 1.5rem;
          background: linear-gradient(135deg, oklch(0.62 0.22 255 / 0.35), oklch(0.6 0.18 300 / 0.25));
          filter: blur(28px);
          z-index: 0;
        }

        /* The logo mark is white — invisible on a light background without
           a backdrop. The app already solves this everywhere else with a
           flat dark-navy chip (:root[data-theme="light"] header img in
           styles.css), but that reads as an out-of-place hard square next
           to this page's own soft cream/blue palette — override it here
           with the same blue-to-violet gradient the sign-in button and
           card glow already use, so it reads as part of this page's look
           instead of a generic app-wide fallback. #id beats the plain
           "header img" element selector at equal !important specificity.
        */
        :root[data-theme="light"] #ahs-landing-header img {
          background: linear-gradient(135deg, #5b7eff, #4c5ac0) !important;
          border-radius: 10px !important;
          padding: 5px !important;
        }
        :root[data-theme="light"] #ahs-landing-hero-logo {
          background: linear-gradient(135deg, #5b7eff, #4c5ac0);
          border-radius: 20px;
          padding: 14px;
        }
      `}</style>
    </div>
  );
}
