/**
 * Receiving Status (Tickets module, Admin/SuperAdmin only) — buckets every
 * ticket by Branch x 3rd-party Ticket Provider, so Admin can see at a glance
 * how many tickets are still "Incoming" (no technician assigned yet) per
 * branch/provider, and whether that provider's data on file is stale.
 */

import type { Ticket } from "./ticketData";
import type { TicketClaimDetails } from "./supabase/claimDetails";

/** A ticket's last-known provider info is considered stale (unsynced) once it's older than this. */
export const SYNC_STALE_HOURS = 24;

/**
 * Same "prefer ticket_source, else manufacturer, else account" fallback
 * overallStatusData.ts's ticketSourceName() uses — kept as its own copy
 * here (same convention every sibling dashboard follows) rather than a
 * shared cross-file export.
 */
export function rawProviderOf(t: Ticket): string {
  const raw = (t.ticketSource || t.manufacturer || t.account || "").trim();
  return raw || "Unknown";
}

/**
 * Collapses TICKET_SOURCES' raw codes (see ticketData.ts) down to the
 * actual portal/site an admin would log into — e.g. "SP"/"SP1" are both
 * just ServicePower pulling in different brands' calls under one account,
 * so they share one link rather than each getting their own row.
 *
 * This is deliberately the full allow-list of ticket-pulling providers the
 * business actually uses today (per direct instruction) — a source that
 * doesn't match any of these returns null and is left off the page
 * entirely, rather than showing up as an unrecognized/"Unknown" row.
 */
const PROVIDER_FAMILY_PREFIXES: Array<[prefix: string, family: string]> = [
  ["Midea", "Midea"],
  ["SP", "ServicePower"],
  ["SB", "ServiceBench - Asurion"],
  ["NSA", "NSA"],
];

export function providerFamilyOf(t: Ticket): string | null {
  const raw = rawProviderOf(t);
  for (const [prefix, family] of PROVIDER_FAMILY_PREFIXES) {
    if (raw.toUpperCase().startsWith(prefix.toUpperCase())) return family;
  }
  return null;
}

/** Real, known login URL for a provider portal — shown as the default link until an Admin overrides it via receiving_status_provider_links. */
export const DEFAULT_PROVIDER_LINKS: Record<string, string> = {
  Midea: "https://callexpert.dexwell.com/Account/Login.aspx",
  ServicePower: "https://hub.servicepower.com/",
  NSA: "https://home2.nationalservicealliance.com/",
};

export function branchOf(t: Ticket): string {
  return (t.location || "").trim() || "Unassigned";
}

/** "Incoming" = no technician assigned yet — the ticket hasn't started being worked. */
export function isIncoming(t: Ticket): boolean {
  return !(t.technician || "").trim();
}

/**
 * A ticket is "synced" if its provider claim details were refreshed within
 * SYNC_STALE_HOURS. There's no live/background sync in this app (only a
 * manual "Sync" action or a per-ticket refresh on the ticket detail page),
 * so this is a staleness proxy, not a real-time match against the provider.
 */
export function isSynced(details: TicketClaimDetails | undefined, nowMs: number): boolean {
  if (!details?.updatedAt) return false;
  const updatedMs = new Date(details.updatedAt).getTime();
  if (isNaN(updatedMs)) return false;
  return nowMs - updatedMs <= SYNC_STALE_HOURS * 60 * 60 * 1000;
}

export interface ReceivingStatusCell {
  branch: string;
  provider: string;
  total: number;
  incoming: number;
  inProgress: number;
  synced: number;
  unsynced: number;
  tickets: Ticket[];
  incomingTickets: Ticket[];
  inProgressTickets: Ticket[];
  syncedTickets: Ticket[];
  unsyncedTickets: Ticket[];
}

export function computeReceivingStatusRows(
  tickets: Ticket[],
  claimDetailsByTicketId: Map<string, TicketClaimDetails>,
  nowMs: number = Date.now()
): ReceivingStatusCell[] {
  const cells = new Map<string, ReceivingStatusCell>();

  for (const t of tickets) {
    const provider = providerFamilyOf(t);
    if (!provider) continue;
    const branch = branchOf(t);
    const key = `${branch}::${provider}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        branch,
        provider,
        total: 0,
        incoming: 0,
        inProgress: 0,
        synced: 0,
        unsynced: 0,
        tickets: [],
        incomingTickets: [],
        inProgressTickets: [],
        syncedTickets: [],
        unsyncedTickets: [],
      };
      cells.set(key, cell);
    }

    cell.total += 1;
    cell.tickets.push(t);

    if (isIncoming(t)) {
      cell.incoming += 1;
      cell.incomingTickets.push(t);
    } else {
      cell.inProgress += 1;
      cell.inProgressTickets.push(t);
    }

    const ticketId = (t as unknown as { _id?: string })._id;
    const details = ticketId ? claimDetailsByTicketId.get(ticketId) : undefined;
    if (isSynced(details, nowMs)) {
      cell.synced += 1;
      cell.syncedTickets.push(t);
    } else {
      cell.unsynced += 1;
      cell.unsyncedTickets.push(t);
    }
  }

  return Array.from(cells.values()).sort((a, b) => a.branch.localeCompare(b.branch) || b.total - a.total);
}
