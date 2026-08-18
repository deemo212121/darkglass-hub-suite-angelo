/**
 * "Who gets notified when someone submits this form" — a multi-select of
 * company accounts, for CustomFormBuilder.tsx's top-level settings area.
 * Empty selection means "no explicit picks" — the existing default (every
 * HR/Admin/Manager account, see findHrFirebaseUids in
 * customFormsBridge.ts) still applies; picking specific people here only
 * narrows that down for this one form.
 *
 * Same dropdown-checkbox-list interaction as AdminUserManagementPage.tsx's
 * RoleMultiSelect, adapted for company user accounts instead of roles —
 * copied rather than imported/exported across files, since that component
 * is local to an unrelated admin page.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { getCompanyUsers, type ProfileRow } from "@/lib/supabase/users";

interface Props {
  /** Firebase uids of the picked accounts. */
  value: string[];
  onChange: (next: string[]) => void;
}

export function NotifyRecipientsPicker({ value, onChange }: Props) {
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        setUsers((await getCompanyUsers()).filter((u) => u.is_active));
      } catch (err) {
        console.error("Failed to load company users:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const labelByUid = useMemo(() => {
    const m: Record<string, string> = {};
    for (const u of users) if (u.firebase_uid) m[u.firebase_uid] = u.display_name || u.email || u.username || u.firebase_uid;
    return m;
  }, [users]);

  const toggle = (uid: string) => onChange(value.includes(uid) ? value.filter((v) => v !== uid) : [...value, uid]);

  const summary = value.length > 0 ? `${value.length} selected: ${value.map((uid) => labelByUid[uid] || uid).join(", ")}` : "Default — every HR/Admin/Manager account";

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="glass-input text-sm py-1.5 px-2.5 rounded-md w-full flex items-center justify-between gap-2 text-left">
        <span className={`truncate ${value.length === 0 ? "text-muted-foreground" : ""}`}>{summary}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-md border border-white/10 bg-slate-900 shadow-xl py-1">
          {loading ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p>
          ) : users.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">No users found.</p>
          ) : (
            users.map((u) => {
              const uid = u.firebase_uid;
              if (!uid) return null;
              const checked = value.includes(uid);
              return (
                <button key={u.id} type="button" onClick={() => toggle(uid)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-white/10">
                  <span className={`h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 ${checked ? "bg-primary border-primary" : "border-white/30"}`}>
                    {checked && <Check className="h-2.5 w-2.5 text-white" />}
                  </span>
                  <span className="flex-1 truncate">{u.display_name || u.email || u.username}</span>
                  <span className="text-[9px] text-muted-foreground uppercase shrink-0">{u.role}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
