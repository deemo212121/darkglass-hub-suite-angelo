import { useEffect, useState } from "react";
import { CalendarX2, Check, ChevronRight, Copy, KeyRound, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getCompanyUsersLite, type ProfileRow } from "@/lib/supabase/users";
import { ensureCompanyClockInCode } from "@/lib/supabase/clockInCodes";
import { supabase } from "@/lib/supabase/client";
import { MissedClockInMeetings } from "@/components/MissedClockInMeetings";
import { getPendingClockInMeetings } from "@/lib/supabase/clockInMeetings";

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
  // Ask the database itself (clock_code_viewer()) — it's the real rule, and
  // it can be stricter than the ticked "Who can see this code" list (Parts
  // roles stay blocked even when ticked). A client-side guess would show
  // cards that then fail to load.
  const { uid } = useAuth();
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    supabase.rpc("clock_code_viewer").then(({ data, error }) => {
      if (!cancelled) setAllowed(!error && data === true);
    });
    return () => { cancelled = true; };
  }, [uid]);
  return allowed;
}

/** Mobile Home card that opens the meetings list — shows how many are waiting. */
export function MeetingsRequiredCard({ onOpen }: { onOpen: () => void }) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    getPendingClockInMeetings().then((m) => { if (!cancelled) setCount(m.length); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const waiting = (count ?? 0) > 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-4 py-3 text-left"
      style={{
        background: waiting ? "rgba(239, 68, 68, 0.12)" : "var(--mt-surface)",
        border: `1px solid ${waiting ? "rgba(248, 113, 113, 0.45)" : "var(--mt-surface-border)"}`,
        borderRadius: 14,
      }}
    >
      <CalendarX2 className={`h-5 w-5 shrink-0 ${waiting ? "text-red-300" : "text-slate-300"}`} />
      <div className="flex-1">
        <div className="text-sm font-semibold text-white">Meetings required</div>
        <div className="text-[11px] text-slate-300">Technicians who missed a clock-in or didn't fix a missed Time Out</div>
      </div>
      {count != null && (
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${waiting ? "bg-red-500 text-white" : "bg-white/10 text-slate-300"}`}>{count}</span>
      )}
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
    </button>
  );
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
