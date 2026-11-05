/**
 * The Hiring panel's Gmail bar: every connected account, and "Connect my Gmail"
 * for HR / Admin / Super Admin. Candidate emails and login credentials go out
 * from whichever account the sender picks (HiringGmailFromSelect). They can use
 * their own accounts and any marked shared; gmailBridge.ts enforces that.
 */
import { useState } from "react";
import { Loader2, Mail, Plus, Users, X } from "lucide-react";
import {
  disconnectHiringGmail,
  setHiringGmailShared,
  startHiringGmailConnect,
  type HiringGmailAccount,
} from "@/lib/supabase/gmailConnection";

export function HiringGmailAccountsBar({
  accounts,
  canManageAll,
  onChanged,
  onError,
}: {
  /** null = the database update (migration 0426) hasn't been run yet. */
  accounts: HiringGmailAccount[] | null;
  canManageAll: boolean;
  onChanged: (change: { action: "disconnected" | "shared" | "unshared"; email: string }) => void;
  onError: (message: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const connect = async () => {
    setConnecting(true);
    try {
      await startHiringGmailConnect();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't start connecting Gmail.");
      setConnecting(false);
    }
  };

  const run = async (account: HiringGmailAccount, action: "disconnected" | "shared" | "unshared") => {
    setBusyId(account.id);
    try {
      if (action === "disconnected") await disconnectHiringGmail(account.id);
      else await setHiringGmailShared(account.id, action === "shared");
      onChanged({ action, email: account.email });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't update that Gmail account.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-sm w-fit max-w-full">
      <Mail className={`h-4 w-4 shrink-0 ${accounts?.length ? "text-green-400" : "text-slate-500"}`} />
      <span className="text-xs text-slate-400 uppercase font-semibold">Hiring Gmail:</span>

      {accounts === null ? (
        <span className="text-xs text-amber-300">Needs the database update first (migration 0426).</span>
      ) : (
        <>
          {accounts.map((a) => {
            const canManage = a.mine || canManageAll;
            const owner = a.mine ? "You" : a.connectedByName || "Someone else";
            return (
              <span
                key={a.id}
                className={`inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md border px-2 py-1 text-xs ${a.mine || a.shared ? "border-white/10 bg-white/5" : "border-white/5 opacity-60"}`}
                title={a.mine || a.shared ? undefined : `Only ${owner} can send from this account unless it's shared.`}
              >
                <span className="text-slate-200 break-all">{a.email}</span>
                <span className="text-slate-500">· {owner}</span>
                {a.shared && (
                  <span className="inline-flex items-center gap-1 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-300">
                    <Users className="h-3 w-3" /> Shared with HR
                  </span>
                )}
                {busyId === a.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
                ) : (
                  canManage && (
                    <>
                      <button
                        type="button"
                        onClick={() => void run(a, a.shared ? "unshared" : "shared")}
                        title={a.shared ? "Only the person who connected it can send from it again" : "Let everyone in HR send from this account"}
                        className="text-[11px] text-blue-300 underline hover:text-blue-200"
                      >
                        {a.shared ? "Stop sharing" : "Share with HR"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { if (confirm(`Disconnect ${a.email} from the Hiring panel?`)) void run(a, "disconnected"); }}
                        title="Disconnect"
                        aria-label={`Disconnect ${a.email}`}
                        className="text-red-300 hover:text-red-200"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )
                )}
              </span>
            );
          })}
          <button
            type="button"
            onClick={() => void connect()}
            disabled={connecting}
            className="inline-flex items-center gap-1 text-xs text-blue-300 underline hover:text-blue-200 disabled:opacity-50"
          >
            {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {connecting ? "Connecting…" : "Connect my Gmail"}
          </button>
        </>
      )}
    </div>
  );
}

/** "From" for anything sent from the Hiring panel. `accounts` is what this person may send from (sendableAccounts). */
export function HiringGmailFromSelect({
  accounts,
  value,
  onChange,
  className,
}: {
  accounts: HiringGmailAccount[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <select aria-label="Send from" value={value} onChange={(e) => onChange(e.target.value)} disabled={accounts.length === 0} className={className}>
      {accounts.length === 0 && <option value="">No Gmail connected</option>}
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.email}{a.mine ? "" : ` (shared by ${a.connectedByName || "HR"})`}
        </option>
      ))}
    </select>
  );
}
