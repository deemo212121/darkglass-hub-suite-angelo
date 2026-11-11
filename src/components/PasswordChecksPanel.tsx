/**
 * Password and Email Management → Password Checks (the view opened by the
 * button beside Add Email; Super Admin only, migration 0441): every page and button that asks
 * for a password first — on / off, how often, and which password:
 *   • Their own login password (checked by Firebase; nothing stored), or
 *   • A set password a Super Admin picks here (Edit password) — typed
 *     passwords are checked against its hash by the database; Super Admins
 *     can see it with Show password (migration 0442), every Show recorded.
 * Built-in checks (Truck Stock → Import, Employee Monitoring → Attendance
 * Status) can be turned off / on; any page can be added. Changes reach open
 * pages right away (realtime).
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, History, KeyRound, Lock, Plus, Trash2 } from "lucide-react";
import { MODULES } from "@/lib/modules";
import { AppModal } from "@/components/ui-kit/AppModal";
import {
  BUILT_IN_PASSWORD_CHECKS,
  FREQUENCY_LABEL,
  isPageCheckKey,
  pageCheckKey,
  refreshPasswordChecks,
  usePasswordChecks,
  type PasswordCheckFrequency,
  type PasswordCheckSetting,
  type PasswordCheckType,
} from "@/lib/passwordChecks";
import {
  getPasswordCheckEvents,
  removePasswordCheck,
  savePasswordCheck,
  revealPasswordCheckPassword,
  setPasswordCheckPassword,
  type PasswordCheckEvent,
} from "@/lib/supabase/passwordChecks";

const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";

const ACTION_LABEL: Record<PasswordCheckEvent["action"], string> = { added: "Added", changed: "Changed", removed: "Removed", password_set: "Password changed", password_viewed: "Password shown" };
const TYPE_LABEL: Record<PasswordCheckType, string> = { own: "Their own login password", set: "A set password" };

interface Current {
  enabled: boolean;
  frequency: PasswordCheckFrequency;
  passwordType: PasswordCheckType;
}

export function PasswordChecksPanel() {
  const { rows, status } = usePasswordChecks();
  const [events, setEvents] = useState<PasswordCheckEvent[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [pick, setPick] = useState("");
  const [pickFrequency, setPickFrequency] = useState<PasswordCheckFrequency>("every_time");
  const [pickType, setPickType] = useState<PasswordCheckType>("own");
  const [editingPassword, setEditingPassword] = useState<{ key: string; label: string; first: boolean } | null>(null);
  /** Set passwords a Super Admin clicked Show on, by check. */
  const [shown, setShown] = useState<Record<string, string>>({});
  const [revealing, setRevealing] = useState<string | null>(null);
  const hide = (key: string) => setShown((s) => { const n = { ...s }; delete n[key]; return n; });
  const toggleShow = async (key: string) => {
    if (shown[key] !== undefined) return hide(key);
    setRevealing(key);
    try {
      const pw = await revealPasswordCheckPassword(key);
      setShown((s) => ({ ...s, [key]: pw }));
      void loadEvents();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't show the password.");
    } finally {
      setRevealing(null);
    }
  };

  const loadEvents = () =>
    getPasswordCheckEvents().then(
      (ev) => { setEvents(ev); setSetupError(null); },
      (e) => setSetupError(/password_check|does not exist|schema cache/i.test(String(e?.message)) ? "Password Checks isn't set up in the database yet — run migration 0441_password_checks.sql in Supabase, then reload." : String(e?.message || e)),
    );
  useEffect(() => { void loadEvents(); }, []);

  // Every page in the app, grouped by module, for "Add a page".
  const pageOptions = useMemo(
    () => MODULES.map((m) => ({ module: m.label, pages: m.submodules.map((s) => ({ key: pageCheckKey(m.slug, s.slug), label: `${m.label} → ${s.title}` })) })),
    [],
  );
  const pageLabel = useMemo(() => new Map(pageOptions.flatMap((g) => g.pages.map((p) => [p.key, p.label] as const))), [pageOptions]);
  const pageChecks = useMemo(() => [...rows.values()].filter((r) => isPageCheckKey(r.key)).sort((a, b) => a.label.localeCompare(b.label)), [rows]);

  const afterChange = () => { refreshPasswordChecks(); void loadEvents(); };

  const save = async (key: string, label: string, next: Current, existing?: PasswordCheckSetting) => {
    setBusyKey(key);
    try {
      await savePasswordCheck({ key, label, ...next }, existing?.id);
      afterChange();
      return true;
    } catch (e: any) {
      toast.error(e?.message || "Couldn't save.");
      return false;
    } finally {
      setBusyKey(null);
    }
  };

  const remove = async (row: PasswordCheckSetting) => {
    if (!window.confirm(`Stop asking for a password on ${row.label}?`)) return;
    setBusyKey(row.key);
    try {
      await removePasswordCheck(row.id);
      afterChange();
      toast.success(`${row.label} no longer asks for a password.`);
    } catch (e: any) {
      toast.error(e?.message || "Couldn't remove it.");
    } finally {
      setBusyKey(null);
    }
  };

  const addPage = async () => {
    if (!pick) return;
    const label = pageLabel.get(pick) ?? pick;
    if (pickType === "set") {
      // Adding it with a set password = set the password (that makes the row too).
      setEditingPassword({ key: pick, label, first: true });
      return;
    }
    if (await save(pick, label, { enabled: true, frequency: pickFrequency, passwordType: "own" }, rows.get(pick))) {
      toast.success(`${label} now asks for a password.`);
      setPick("");
    }
  };

  /** Picking "A set password" with none set yet opens Edit password first. */
  const changeType = (key: string, label: string, existing: PasswordCheckSetting | undefined, current: Current, type: PasswordCheckType) => {
    if (type === "set" && !existing?.passwordSetAt) {
      setEditingPassword({ key, label, first: true });
      return;
    }
    void save(key, label, { ...current, passwordType: type }, existing);
  };

  const controls = (key: string, label: string, existing: PasswordCheckSetting | undefined, current: Current) => (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={current.enabled}
        aria-label={`${label}: ${current.enabled ? "on" : "off"}`}
        disabled={busyKey === key}
        onClick={() => void save(key, label, { ...current, enabled: !current.enabled }, existing)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition disabled:opacity-50 ${current.enabled ? "bg-emerald-500/80 border-emerald-400" : "bg-white/10 border-white/20"}`}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${current.enabled ? "translate-x-6" : "translate-x-1"}`} />
      </button>
      <span className={`text-xs w-7 ${current.enabled ? "text-emerald-300" : "text-muted-foreground"}`}>{current.enabled ? "On" : "Off"}</span>
      <select
        aria-label={`${label}: how often`}
        className="glass-input !w-auto text-xs !py-1 !pl-2 !pr-7 h-8"
        value={current.frequency}
        disabled={busyKey === key || !current.enabled}
        onChange={(e) => void save(key, label, { ...current, frequency: e.target.value as PasswordCheckFrequency }, existing)}
      >
        <option value="every_time">{FREQUENCY_LABEL.every_time}</option>
        <option value="once_per_session">{FREQUENCY_LABEL.once_per_session}</option>
      </select>
      <select
        aria-label={`${label}: which password`}
        className="glass-input !w-auto text-xs !py-1 !pl-2 !pr-7 h-8"
        value={current.passwordType}
        disabled={busyKey === key || !current.enabled}
        onChange={(e) => changeType(key, label, existing, current, e.target.value as PasswordCheckType)}
      >
        <option value="own">{TYPE_LABEL.own}</option>
        <option value="set">{TYPE_LABEL.set}</option>
      </select>
      {current.passwordType === "set" && existing?.passwordSetAt && (
        <button
          type="button"
          className="btn text-xs !py-1"
          disabled={revealing === key}
          aria-pressed={shown[key] !== undefined}
          onClick={() => void toggleShow(key)}
          title="Show the set password (recorded in Recent changes)"
        >
          {shown[key] !== undefined ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {revealing === key ? "Showing…" : shown[key] !== undefined ? "Hide password" : "Show password"}
        </button>
      )}
      {current.passwordType === "set" && (
        <button type="button" className="btn text-xs !py-1" disabled={busyKey === key} onClick={() => { hide(key); setEditingPassword({ key, label, first: !existing?.passwordSetAt }); }}>
          <KeyRound className="h-3.5 w-3.5" /> Edit password
        </button>
      )}
      {current.passwordType === "set" && shown[key] !== undefined && (
        <code className="basis-full sm:basis-auto rounded border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-100 select-all" aria-label={`${label} password`}>{shown[key]}</code>
      )}
    </div>
  );

  const changedBy = (r: PasswordCheckSetting | undefined) => (
    <>
      {r?.updatedByName && <div className="text-[11px] text-muted-foreground">Last changed by {r.updatedByName} · {fmtDateTime(r.updatedAt)}</div>}
      {r?.passwordType === "set" && r.passwordSetAt && (
        <div className="text-[11px] text-muted-foreground">Password set by {r.passwordSetByName || "—"} · {fmtDateTime(r.passwordSetAt)}</div>
      )}
    </>
  );

  const currentOf = (r: PasswordCheckSetting | undefined, defaultFrequency: PasswordCheckFrequency): Current =>
    r ? { enabled: r.enabled, frequency: r.frequency, passwordType: r.passwordType } : { enabled: true, frequency: defaultFrequency, passwordType: "own" };

  return (
    <div className="grid gap-4">
      <div className="rounded-lg border border-[var(--color-panel-border)] px-4 py-3 text-sm text-muted-foreground flex items-start gap-2">
        <KeyRound className="h-4 w-4 mt-0.5 shrink-0 text-blue-400" />
        <div>
          Each one asks either for <b className="text-foreground">their own login password</b> (the one they sign in with) or for{" "}
          <b className="text-foreground">a set password</b> you choose with Edit password. Only Super Admins can see a set password (Show password), and every Show is recorded below.
          Super Admins are asked too. <b className="text-foreground">Once per session</b> asks once, then not again until that browser tab is closed.
          Changes apply right away.
        </div>
      </div>

      {setupError && <div className="rounded-lg border border-red-500/30 bg-red-500/5 text-sm text-red-300 px-4 py-3">{setupError}</div>}

      <section className="rounded-lg border border-[var(--color-panel-border)]">
        <h2 className="px-4 pt-3 pb-2 text-sm font-semibold">Built into the app</h2>
        <ul>
          {BUILT_IN_PASSWORD_CHECKS.map((b) => {
            const saved = rows.get(b.key);
            return (
              <li key={b.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-[var(--color-panel-border)]">
                <div className="min-w-0">
                  <div className="font-medium flex items-center gap-1.5"><Lock className="h-3.5 w-3.5 text-amber-300" />{b.label}</div>
                  <div className="text-xs text-muted-foreground">{b.where}</div>
                  {changedBy(saved)}
                </div>
                {controls(b.key, b.label, saved, currentOf(saved, b.defaultFrequency))}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-lg border border-[var(--color-panel-border)]">
        <h2 className="px-4 pt-3 pb-2 text-sm font-semibold">Pages that ask for a password ({pageChecks.length})</h2>
        <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
          <select aria-label="Page to add" className="glass-input !w-auto text-sm min-w-[16rem] max-w-full" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Pick a page…</option>
            {pageOptions.map((g) => (
              <optgroup key={g.module} label={g.module}>
                {g.pages.map((p) => (
                  <option key={p.key} value={p.key} disabled={rows.has(p.key)}>
                    {p.label}{rows.has(p.key) ? " (already added)" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <select aria-label="How often for the new page" className="glass-input !w-auto text-sm !pr-8" value={pickFrequency} onChange={(e) => setPickFrequency(e.target.value as PasswordCheckFrequency)}>
            <option value="every_time">{FREQUENCY_LABEL.every_time}</option>
            <option value="once_per_session">{FREQUENCY_LABEL.once_per_session}</option>
          </select>
          <select aria-label="Which password for the new page" className="glass-input !w-auto text-sm !pr-8" value={pickType} onChange={(e) => setPickType(e.target.value as PasswordCheckType)}>
            <option value="own">{TYPE_LABEL.own}</option>
            <option value="set">{TYPE_LABEL.set}</option>
          </select>
          <button type="button" className="btn btn-primary text-sm" disabled={!pick || busyKey === pick || status !== "ready"} onClick={() => void addPage()}>
            <Plus className="h-4 w-4" /> Add page
          </button>
        </div>
        {pageChecks.length === 0 ? (
          <div className="px-4 py-4 border-t border-[var(--color-panel-border)] text-sm text-muted-foreground">No pages yet — pick one above to make it ask for a password before it opens.</div>
        ) : (
          <ul>
            {pageChecks.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-[var(--color-panel-border)]">
                <div className="min-w-0">
                  <div className="font-medium flex items-center gap-1.5"><Lock className="h-3.5 w-3.5 text-amber-300" />{r.label}</div>
                  {changedBy(r)}
                </div>
                <div className="flex items-center gap-2">
                  {controls(r.key, r.label, r, currentOf(r, "every_time"))}
                  <button type="button" aria-label={`Remove ${r.label}`} title="Remove" className="p-1.5 rounded text-muted-foreground hover:text-red-300 hover:bg-red-500/10 disabled:opacity-50" disabled={busyKey === r.key} onClick={() => void remove(r)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-[var(--color-panel-border)]">
        <h2 className="px-4 pt-3 pb-2 text-sm font-semibold flex items-center gap-1.5"><History className="h-4 w-4" /> Recent changes</h2>
        {events.length === 0 ? (
          <div className="px-4 py-3 border-t border-[var(--color-panel-border)] text-sm text-muted-foreground">No changes yet.</div>
        ) : (
          <ul className="text-sm max-h-64 overflow-y-auto">
            {events.slice(0, 50).map((e) => (
              <li key={e.id} className="px-4 py-2 border-t border-[var(--color-panel-border)] flex flex-wrap gap-x-2">
                <span className="text-muted-foreground whitespace-nowrap">{fmtDateTime(e.createdAt)}</span>
                <span className={e.action === "removed" ? "text-red-300" : e.action === "added" ? "text-emerald-300" : e.action === "password_set" || e.action === "password_viewed" ? "text-amber-300" : ""}>{ACTION_LABEL[e.action] ?? e.action}</span>
                <span className="font-medium">{e.label}</span>
                {e.detail && e.action !== "password_set" && e.action !== "password_viewed" && <span className="text-muted-foreground">— {e.detail}</span>}
                <span className="text-muted-foreground">by {e.actorName || "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editingPassword && (
        <EditPasswordModal
          label={editingPassword.label}
          first={editingPassword.first}
          onClose={() => setEditingPassword(null)}
          onSave={async (password) => {
            await setPasswordCheckPassword(editingPassword.key, editingPassword.label, password);
            hide(editingPassword.key);
            afterChange();
            toast.success(`${editingPassword.label} now asks for the set password.`);
            if (editingPassword.key === pick) setPick("");
            setEditingPassword(null);
          }}
        />
      )}
    </div>
  );
}

function EditPasswordModal({ label, first, onClose, onSave }: { label: string; first: boolean; onClose: () => void; onSave: (password: string) => Promise<void> }) {
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = pw.length < 4 ? "Use at least 4 characters." : pw !== again ? "The two passwords don't match." : null;

  const submit = async () => {
    if (problem) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(pw);
    } catch (e: any) {
      setError(e?.message || "Couldn't save the password.");
    } finally {
      setBusy(false);
    }
  };

  const input = "glass-input text-sm w-full pr-9";
  return (
    <AppModal
      title={first ? "Set password" : "Edit password"}
      description={label}
      icon={<KeyRound />}
      size="sm"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || !!problem}>{busy ? "Saving…" : "Save password"}</button>
        </>
      }
    >
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <p className="text-xs text-muted-foreground">
          Everyone opening this will type this password instead of their own. Share it only with the people who should get in.
          {first ? "" : " The old one stops working right away."}
        </p>
        <label className="grid gap-1 text-xs text-muted-foreground">
          New password
          <div className="relative">
            <input type={show ? "text" : "password"} autoComplete="new-password" autoFocus className={input} value={pw} onChange={(e) => setPw(e.target.value)} />
            <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow((s) => !s)}>
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Type it again
          <input type={show ? "text" : "password"} autoComplete="new-password" className={input} value={again} onChange={(e) => setAgain(e.target.value)} />
        </label>
        {(error || (pw && problem)) && <p className="text-xs text-red-300">{error || problem}</p>}
        <button type="submit" className="hidden" />
      </form>
    </AppModal>
  );
}
