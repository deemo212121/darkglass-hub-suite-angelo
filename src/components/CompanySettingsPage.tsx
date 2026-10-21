import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSmartBack } from "@/hooks/useSmartBack";
import { ChevronLeft, Lock, Send } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { getCompanyByLegacyCode, updateCompanyDetails, type CompanyDetails } from "@/lib/supabase/companies";
import { isPreAuthSubmitEnabled, setPreAuthSubmitEnabled } from "@/lib/supabase/preAuth";

const SUBSCRIPTION_PLANS = ["basic", "professional", "enterprise"] as const;

/**
 * Self-service company record editor — the one thing the per-company
 * SUPERADMIN role can do that a regular ADMIN can't (see
 * 0099_role_hierarchy_split.sql's companies_update policy). Previously this
 * was only possible via the platform /superadmin console's "Edit Company"
 * form.
 */
export function CompanySettingsPage({ sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(() => navigate({ to: "/m/$module", params: { module: "admin" } }));
  const { companyId } = useAuth(); // this is the company's legacy_code
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState<CompanyDetails>({
    companyName: "",
    address: "",
    city: "",
    state: "",
    zipCode: "",
    phoneNumber: "",
    email: "",
    subscriptionPlan: "basic",
    loginAlias: "",
  });

  // Claims → Pre-Auth: whether Submit actually sends to ServicePower. Off by default.
  const [preAuthSend, setPreAuthSend] = useState<boolean | null>(null);
  const [preAuthBusy, setPreAuthBusy] = useState(false);
  const [preAuthMsg, setPreAuthMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!companyId) return;
    isPreAuthSubmitEnabled(companyId).then(setPreAuthSend).catch(() => setPreAuthSend(false));
  }, [companyId]);
  const togglePreAuthSend = async () => {
    if (!companyId || preAuthSend === null) return;
    const next = !preAuthSend;
    if (next && !window.confirm("Turn ON sending Pre-Auths to ServicePower?\n\nAfter this, Submit on Claims → Pre-Auth sends a real Request for Authorization to ServicePower (it still asks before each one).")) return;
    setPreAuthBusy(true);
    setPreAuthMsg(null);
    try {
      await setPreAuthSubmitEnabled(companyId, next);
      setPreAuthSend(next);
      setPreAuthMsg(next ? "Sending is ON." : "Sending is OFF — nothing goes to ServicePower.");
    } catch (err) {
      setPreAuthMsg(`Error: ${err instanceof Error ? err.message : "Couldn't change it"}`);
    } finally {
      setPreAuthBusy(false);
    }
  };

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const details = await getCompanyByLegacyCode(companyId);
      if (cancelled) return;
      if (details) setForm(details);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const update = (key: keyof CompanyDetails, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!companyId) return;
    setSaving(true);
    setStatus(null);
    try {
      await updateCompanyDetails(companyId, {
        companyName: form.companyName,
        address: form.address || "",
        city: form.city || "",
        state: form.state || "",
        zipCode: form.zipCode || "",
        phoneNumber: form.phoneNumber || "",
        email: form.email || "",
        subscriptionPlan: (form.subscriptionPlan ?? "basic") as (typeof SUBSCRIPTION_PLANS)[number],
        loginAlias: form.loginAlias || null,
      });
      setStatus("Saved.");
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : "Save failed"}`);
    } finally {
      setSaving(false);
    }
  };

  const labelCls = "block text-xs uppercase tracking-[0.08em] text-slate-400";
  const inputCls = "w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500";

  return (
    <main className="flex-1 bg-slate-950 py-6">
      <div className="max-w-3xl mx-auto px-6">
        <div className="flex items-center gap-3 text-white mb-6">
          <button type="button" onClick={goBack} className="btn">
            <ChevronLeft className="h-4 w-4" />
            Admin
          </button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{sub.title}</h1>
            <p className="mt-1 text-sm text-slate-300">{sub.description}</p>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <div className="rounded-xl border border-white/15 bg-white/5 p-6">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1.5 text-sm">
                <span className={labelCls}>Company Name</span>
                <input value={form.companyName} onChange={(e) => update("companyName", e.target.value)} className={inputCls} />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className={labelCls}>Email</span>
                <input type="email" value={form.email ?? ""} onChange={(e) => update("email", e.target.value)} className={inputCls} />
              </label>
              <label className="space-y-1.5 text-sm md:col-span-2">
                <span className={labelCls}>Address</span>
                <input value={form.address ?? ""} onChange={(e) => update("address", e.target.value)} className={inputCls} />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className={labelCls}>City</span>
                <input value={form.city ?? ""} onChange={(e) => update("city", e.target.value)} className={inputCls} />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className={labelCls}>State</span>
                <input value={form.state ?? ""} maxLength={2} onChange={(e) => update("state", e.target.value.toUpperCase())} className={inputCls} />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className={labelCls}>ZIP Code</span>
                <input value={form.zipCode ?? ""} onChange={(e) => update("zipCode", e.target.value)} className={inputCls} />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className={labelCls}>Phone Number</span>
                <input value={form.phoneNumber ?? ""} onChange={(e) => update("phoneNumber", e.target.value)} className={inputCls} />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className={labelCls}>Subscription Plan</span>
                <select value={form.subscriptionPlan ?? "basic"} onChange={(e) => update("subscriptionPlan", e.target.value)} className={inputCls}>
                  {SUBSCRIPTION_PLANS.map((p) => (
                    <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5 text-sm">
                <span className={labelCls}>Login Company ID <span className="normal-case text-[10px] text-slate-500">(optional — once set, this REPLACES the Company ID above; employees must enter this instead to log in)</span></span>
                <input value={form.loginAlias ?? ""} onChange={(e) => update("loginAlias", e.target.value.toUpperCase())} className={inputCls} />
              </label>
            </div>

            <div className="mt-6 flex items-center gap-4">
              <button onClick={handleSave} disabled={saving} className="btn btn-primary disabled:opacity-50">
                {saving ? "Saving…" : "Save Changes"}
              </button>
              {status && <span className="text-sm text-slate-300">{status}</span>}
            </div>
          </div>
        )}

        {/* ServicePower — sending switches. Saved on its own, not with Save Changes. */}
        <div className="mt-6 rounded-xl border border-white/15 bg-white/5 p-6">
          <h2 className="text-lg font-semibold text-white">ServicePower</h2>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <p className="text-sm font-medium text-white flex items-center gap-1.5">
                {preAuthSend ? <Send className="h-4 w-4 text-emerald-300" /> : <Lock className="h-4 w-4 text-amber-300" />}
                Send Pre-Auths to ServicePower
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Claims → Pre-Auth&apos;s Submit button. While OFF, Pre-Auths are only saved in the app and nothing is sent. When ON, Submit sends a real Request for Authorization to ServicePower (it asks before each one).
              </p>
              {preAuthMsg && <p className={`mt-2 text-xs ${preAuthMsg.startsWith("Error") ? "text-red-300" : "text-slate-300"}`}>{preAuthMsg}</p>}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!!preAuthSend}
              onClick={() => void togglePreAuthSend()}
              disabled={preAuthBusy || preAuthSend === null}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50 ${preAuthSend ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200" : "border-amber-400/40 bg-amber-500/10 text-amber-200"}`}
            >
              <span className={`relative inline-block h-4 w-8 rounded-full transition ${preAuthSend ? "bg-emerald-500" : "bg-slate-600"}`}>
                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${preAuthSend ? "left-[18px]" : "left-0.5"}`} />
              </span>
              {preAuthSend === null ? "…" : preAuthSend ? "ON" : "OFF"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
