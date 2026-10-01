/**
 * CSR Main Dashboard → Time Off Calendar. A view-only copy of Employee
 * Monitoring's Time Off Calendar (HrCalendarTab with readOnly): every active
 * employee, with the calendar's own month / search / role / branch / leave
 * type filters, so CSR can see who's out before booking — but no plotting,
 * editing, approving or cancelling.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getCompanyUsers, getMyProfileId, type ProfileRow } from "@/lib/supabase/users";
import { HrCalendarTab } from "@/components/HrCalendarTab";

export function CsrTimeOffCalendarTab() {
  const { uid, displayName } = useAuth();
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rows, me] = await Promise.all([getCompanyUsers(), uid ? getMyProfileId(uid) : Promise.resolve(null)]);
        if (cancelled) return;
        setProfiles(rows);
        setMyProfileId(me);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const employees = useMemo(
    () =>
      profiles
        .filter((p) => p.is_active)
        .map((p) => ({
          id: p.id,
          name: p.display_name || p.email,
          branch: p.assigned_branch || "",
          status: "active",
          role: p.role,
          startDate: p.created_at?.slice(0, 10) || null,
          managerName: p.manager_name || null,
          offDays: p.off_days ?? null,
        })),
    [profiles]
  );

  if (loading) {
    return (
      <div className="panel p-10 text-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin inline" />
      </div>
    );
  }
  return <HrCalendarTab employees={employees} myProfileId={myProfileId} myDisplayName={displayName ?? null} readOnly />;
}
