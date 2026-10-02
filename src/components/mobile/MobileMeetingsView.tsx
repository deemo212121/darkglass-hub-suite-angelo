import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { getCompanyUsersLite, type ProfileRow } from "@/lib/supabase/users";
import { CLOCK_CODE_ALWAYS_VIEWERS, getClockCodeViewerRoles } from "@/lib/supabase/clockInCodes";
import { MissedClockInMeetings } from "@/components/MissedClockInMeetings";

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
