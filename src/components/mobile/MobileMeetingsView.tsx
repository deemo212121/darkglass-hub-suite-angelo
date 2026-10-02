import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getCompanyUsersLite, type ProfileRow } from "@/lib/supabase/users";
import { CLOCK_CODE_ALWAYS_VIEWERS, ensureCompanyClockInCode, getClockCodeViewerRoles } from "@/lib/supabase/clockInCodes";
import { MissedClockInMeetings } from "@/components/MissedClockInMeetings";

/**
 * Mobile Home → today's company clock-in code, for whoever can see it
 * (same rule as the desktop Clock-In Codes page; the database decides).
 */
export function TodaysClockInCodeCard() {
  const [code, setCode] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let cancelled = false;
    ensureCompanyClockInCode()
      .then((c) => { if (!cancelled) setCode(c.code); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);
  if (failed) return null;
  return (
    <div
      className="flex items-center gap-3 px-4 py-3"
      style={{ background: "var(--mt-surface)", border: "1px solid var(--mt-surface-border)", borderRadius: 14 }}
    >
      <KeyRound className="h-5 w-5 shrink-0 text-blue-300" />
      <div className="flex-1">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-300">Today's clock-in code</div>
        {code ? (
          <div className="font-mono text-3xl font-bold tracking-[0.3em] text-white tabular-nums">{code}</div>
        ) : (
          <Loader2 className="mt-1 h-5 w-5 animate-spin text-slate-400" />
        )}
      </div>
      <button
        type="button"
        disabled={!code}
        onClick={() => {
          if (!code) return;
          void navigator.clipboard?.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/**
 * Whoever can see the daily clock-in code (HR / Admin / SuperAdmin + the
 * roles picked on the Clock-In Codes page — same rule the database's
 * clock_code_viewer() uses) handles missed clock-in / Time Out meetings.
 */
export function useCanSeeClockInMeetings(): boolean {
  const { role, extraRoles } = useAuth();
  const [viewerRoles, setViewerRoles] = useState<string[]>([]);
  useEffect(() => {
    getClockCodeViewerRoles().then(setViewerRoles).catch(() => setViewerRoles([]));
  }, []);
  const held = [role, ...(extraRoles ?? [])].map((r) => String(r ?? "").trim().toUpperCase());
  const allowed = new Set<string>([...CLOCK_CODE_ALWAYS_VIEWERS, "SUPERSUPERADMIN", ...viewerRoles.map((r) => r.toUpperCase())]);
  return held.some((r) => allowed.has(r));
}

/** Mobile → "Meetings required": the same list as the Clock-In Codes page. */
export function MobileMeetingsView() {
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  useEffect(() => {
    getCompanyUsersLite().then(setProfiles).catch(() => setProfiles([]));
  }, []);
  return (
    <div className="mtech-scroll">
      <div className="mtech-payroll-heading">
        <div className="mtech-payroll-name">Meetings required</div>
        <div className="mtech-payroll-sub">Missed clock-ins and missed Time Outs not fixed in time</div>
      </div>
      <MissedClockInMeetings profiles={profiles} />
    </div>
  );
}
