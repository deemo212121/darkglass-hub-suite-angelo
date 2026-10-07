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
export function TodaysClockInCodeCard({ compact = false }: { compact?: boolean } = {}) {
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
  const copy = () => {
    if (!code) return;
    void navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  if (compact) {
    // Top-right of the Home hero card: small label, the digits, a round copy button.
    return (
      <div className="mh-code-mini">
        <span className="mh-code-mini-label">Clock-in code</span>
        <div className="flex items-center gap-1.5">
          {code ? (
            <div className="mh-code mh-code--mini" aria-label={`Today's clock-in code ${code}`}>
              {code.split("").map((ch, i) => (
                <span key={i} className="mh-code-digit">
                  {ch}
                </span>
              ))}
            </div>
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-white/70" />
          )}
          <button type="button" disabled={!code} onClick={copy} className="mh-code-copy" aria-label={copied ? "Copied" : "Copy code"} title={copied ? "Copied" : "Copy code"}>
            {copied ? <Check /> : <Copy />}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="mh-card mh-card--row flex items-center gap-2.5">
      <span className="mh-icon-tile mh-icon-tile--sm" aria-hidden>
        <KeyRound />
      </span>
      <div className="mh-card-title min-w-0 flex-1 leading-tight">Today's clock-in code</div>
      {code ? (
        <div className="mh-code" aria-label={`Code ${code}`}>
          {code.split("").map((ch, i) => (
            <span key={i} className="mh-code-digit">
              {ch}
            </span>
          ))}
        </div>
      ) : (
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      )}
      <button
        type="button"
        disabled={!code}
        onClick={copy}
        className="mh-pill-btn"
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
      className={`mh-card flex w-full items-center gap-3 text-left ${waiting ? "mh-card--alert" : ""}`}
    >
      <span className={`mh-icon-tile ${waiting ? "mh-icon-tile--alert" : ""}`} aria-hidden>
        <CalendarX2 />
      </span>
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
