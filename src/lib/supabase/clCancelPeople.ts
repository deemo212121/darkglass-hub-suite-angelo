/**
 * Admin → Approval Chain → Philippines → "Who can set CL-Cancelled" (migration
 * 0416): people who can move a ticket to CL-Cancelled whatever their user type,
 * on top of the role rule (roleLabels.ts canSetCancelledStatus). Read on the
 * ticket page, Work Planner and the mobile app through useOnClCancelList.
 */
import { useEffect, useState } from "react";
import { supabase } from "./client";
import { getMyProfileId } from "./users";
import { useAuth } from "@/lib/auth";

/** Everyone on the list — [] when it's empty or migration 0416 hasn't been run. */
export async function getClCancelPeopleIds(): Promise<string[]> {
  const { data, error } = await supabase.from("cl_cancel_people").select("profile_id");
  if (error) return [];
  return (data ?? []).map((r: any) => r.profile_id as string);
}

/** True when migration 0416 hasn't been run — the Approval Chain card says so. */
export async function isClCancelPeopleMissing(): Promise<boolean> {
  const { error } = await supabase.from("cl_cancel_people").select("id").limit(1);
  return !!error && /cl_cancel_people|does not exist|schema cache/i.test(error.message);
}

/** Replace the list (Admin / Super Admin). */
export async function setClCancelPeopleIds(profileIds: string[]): Promise<void> {
  const { error: delError } = await supabase.from("cl_cancel_people").delete().not("id", "is", null);
  if (delError) throw new Error(delError.message);
  listCache = null;
  if (profileIds.length === 0) return;
  const { error } = await supabase.from("cl_cancel_people").insert(profileIds.map((profile_id) => ({ profile_id })));
  if (error) throw new Error(error.message);
}

let listCache: Promise<Set<string>> | null = null;
const myIdCache = new Map<string, Promise<string | null>>();

/** Is the signed-in person on the list? false until it has loaded. */
export function useOnClCancelList(): boolean {
  const { uid } = useAuth();
  const [listed, setListed] = useState(false);
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    listCache ??= getClCancelPeopleIds().then((ids) => new Set(ids));
    if (!myIdCache.has(uid)) myIdCache.set(uid, getMyProfileId(uid));
    Promise.all([listCache, myIdCache.get(uid)!])
      .then(([ids, me]) => { if (!cancelled) setListed(!!me && ids.has(me)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [uid]);
  return listed;
}
