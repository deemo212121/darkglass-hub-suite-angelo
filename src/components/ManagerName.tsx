/**
 * A person's manager as shown in Manager columns: the account the typed
 * manager_name points to (findPersonByName — "Jerich Leonard Bolico" shows as
 * the account "Jerich Bolico"), with a red DEACTIVATED tag when that account
 * is deactivated, or an amber NOT FOUND tag when no account matches — so it's
 * clear at a glance who actually gets this person's notifications.
 */
import { findPersonByName } from "@/lib/personName";

type Person = { display_name?: string | null; is_active?: boolean | null };

export type ManagerResolution = { name: string; flag: "" | "Deactivated" | "Not found" };

/** The account name and flag for a typed manager name ("" name = none set). */
export function resolveManager(typed: string | null | undefined, people: readonly Person[]): ManagerResolution {
  const t = (typed || "").trim();
  if (!t || t === "—" || t.toLowerCase() === "unassigned") return { name: "", flag: "" };
  const live = findPersonByName(t, people.filter((p) => p.is_active !== false));
  if (live) return { name: live.display_name || t, flag: "" };
  const gone = findPersonByName(t, people.filter((p) => p.is_active === false));
  if (gone) return { name: gone.display_name || t, flag: "Deactivated" };
  return { name: t, flag: "Not found" };
}

export function ManagerTag({ flag }: { flag: ManagerResolution["flag"] }) {
  if (!flag) return null;
  return (
    <span
      title={
        flag === "Deactivated"
          ? "This manager's account is deactivated — assign a new manager"
          : "No account has this name — the manager won't get notifications. Fix the Manager name to match their account."
      }
      className={`ml-1.5 inline-block rounded border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide align-middle ${
        flag === "Deactivated" ? "border-red-500/40 bg-red-500/10 text-red-300" : "border-amber-500/40 bg-amber-500/10 text-amber-300"
      }`}
    >
      {flag}
    </span>
  );
}

export function ManagerName({ name, people, empty = "—" }: { name: string | null | undefined; people: readonly Person[]; empty?: string }) {
  const r = resolveManager(name, people);
  if (!r.name) return <>{empty}</>;
  return (
    <>
      {r.name}
      <ManagerTag flag={r.flag} />
    </>
  );
}
