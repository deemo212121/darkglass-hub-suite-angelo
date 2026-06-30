/**
 * ServicePower SOAP Sync - Pull Calls and Convert to Tickets
 * 
 * This module fetches calls from ServicePower SOAP API and converts them
 * to your local ticket format for display in the ticket list.
 */

import type { Ticket } from './ticketData';
import { parseGetCallInfoResponse, formatServicePowerDate } from './servicePowerSoapParser';
import { ZIP_COVERAGE, LOCATIONS_DATA, lookupZip } from './zipCoverage';
import { mapSource } from './mfgSource';
import { LOCATIONS } from './locations';
import { normalizeTimePeriod } from './timeframes';

// Map branch label (e.g. "San Antonio") -> 2-letter state code (e.g. "TX").
// Built from LOCATIONS_DATA which carries the branch office state. Used as a
// fallback when ServicePower's PostcodeLevel1 is blank.
const BRANCH_STATE: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const entry of LOCATIONS_DATA) {
    if (entry.location && entry.state) {
      out[entry.location.replace(/\s+/g, '').toLowerCase()] = entry.state;
    }
  }
  return out;
})();

// Normalise a branch label so it matches the canonical LOCATIONS list. The
// ZIP_COVERAGE table uses "Jackson,MS" / "Jackson,TN" (no space) while the
// rest of the app uses "Jackson, MS" / "Jackson, TN". This ensures the
// ticket-list Location dropdown always matches the value we save.
function canonicalBranchLabel(raw: string): string {
  if (!raw) return '';
  const stripped = raw.replace(/\s+/g, '').toLowerCase();
  for (const loc of LOCATIONS) {
    if (loc.replace(/\s+/g, '').toLowerCase() === stripped) return loc;
  }
  return raw;
}

// Convert "Texas" -> "TX". Pass-through on anything that's already a 2-letter
// uppercase code or empty. ServicePower sometimes returns the long form so
// we want a stable short form to store.
const FULL_STATE_TO_CODE: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX',
  utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
};
function normalizeStateCode(raw: string): string {
  const v = String(raw ?? '').trim();
  if (!v) return '';
  if (v.length === 2) return v.toUpperCase();
  const code = FULL_STATE_TO_CODE[v.toLowerCase()];
  return code || v;
}

/**
 * Fetch calls from ServicePower SOAP API by date range.
 * Dates must be in ServicePower format: "mm/dd/yyyy HH:mm:ss".
 * Note: ServicePower limits each request to a 2-day range (error SP007).
 */
export async function fetchServicePowerCalls(params: {
  fromDate?: string; // Format: mm/dd/yyyy HH:mm:ss
  toDate?: string;   // Format: mm/dd/yyyy HH:mm:ss
  callNo?: string;
}): Promise<{ success: boolean; calls: any[]; error?: any; rawXml?: string }> {
  try {
    const response = await fetch('/api/servicepower', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'getCallInfo',
        params: {
          fromDate: params.fromDate,
          toDate: params.toDate,
          callNo: params.callNo,
        }
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch calls from ServicePower');
    }

    const result = await response.json();
    
    // Parse the XML response
    const parsed = parseGetCallInfoResponse(result.xml);
    
    return {
      success: parsed.success,
      calls: parsed.calls,
      error: parsed.error,
      rawXml: result.xml, // expose for debugging
    };
  } catch (error) {
    return {
      success: false,
      calls: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Map a ServicePower MfgId code to a readable work-order Source name.
 * SP's UI shows this as "Work Order Source". The actual map lives in
 * src/lib/mfgSource.ts so the supabase tickets layer can read it without
 * pulling in this whole sync module (avoids a circular import).
 */
export { mapSource };

/**
 * Decide the initial AHS Repair Status for a ticket newly imported from
 * ServicePower. Based on the ServicePower callStatus and (for Accepted)
 * the work-order Source:
 *  - Cancelled            -> "CL-Cancelled"
 *  - Completed            -> "CL-Ready to Complete"
 *  - Accepted + NSA       -> "CSR-Needs Scheduling"
 *  - Accepted + others    -> "CSR-Assigned to ASC"
 *
 * NOTE: this is only used on first insert. On subsequent re-syncs the local
 * status set by AHS users (e.g. CSR-Acknowledged once a CSR clicks Acknowledge)
 * is preserved by upsertTicketFromServicePower so we never clobber it.
 */
function initialAhsStatusForCall(call: any, source: string): string {
  const callStatus = String(call?.callStatus ?? '').toLowerCase();
  if (callStatus.includes('cancel')) return 'CL-Cancelled';
  if (callStatus.includes('complete')) return 'CL-Ready to Complete';
  const s = (source || '').trim().toUpperCase();
  if (s.includes('NSA')) return 'CSR-Needs Scheduling';
  return 'CSR-Assigned to ASC';
}

/**
 * Map a ServicePower WarrantyType code to readable text.
 * SC = Service Contract, IW = In Warranty, OW/OOW = Out of Warranty.
 */
const WARRANTY_TYPE_LABEL: Record<string, string> = {
  SC: 'Service Contract',
  IW: 'In Warranty',
  OW: 'Out of Warranty',
  OOW: 'Out of Warranty',
};
function mapWarrantyType(code: string | null | undefined): string {
  const c = String(code ?? '').trim().toUpperCase();
  return WARRANTY_TYPE_LABEL[c] || c || '';
}

/**
 * Cities that aren't in our autogenerated ZIP_COVERAGE table but the user has
 * explicitly confirmed belong to a given branch. Checked BEFORE the loose
 * city-name walk because that walk picks whichever location happened to share
 * a name first (e.g. Salem matched Columbus).
 *
 * Keys can be either "<lowercased city>" or "<lowercased city>|<state code>"
 * for cities that exist in multiple states.
 */
const CITY_BRANCH_OVERRIDES: Record<string, string> = {
  // Salem (SC + NC) — Oconee/Forsyth county, Asheville coverage.
  "salem": "Asheville",
  "salem|sc": "Asheville",
  "salem|nc": "Asheville",
};

/**
 * Resolve the AHS branch ("San Antonio", "Atlanta", ...) for a ServicePower
 * customer. Tries the 5-digit zip first via ZIP_COVERAGE, then an explicit
 * CITY_BRANCH_OVERRIDES check, then a loose city-name match against the
 * coverage table. Returns "" when nothing matches so callers can pick a
 * sensible default.
 */
export function resolveBranchFromCustomer(consumer: any): string {
  const rawZip = String(consumer?.postcode ?? '').trim();
  const zip5 = (rawZip.match(/\d{5}/) || [''])[0];
  // lookupZip checks runtime (Supabase Location Management) overrides FIRST,
  // then the static ZIP_COVERAGE table — so user-added zips like 29676 SALEM
  // resolve to Asheville even though they're not in the autogenerated map.
  if (zip5) {
    const cov = lookupZip(zip5);
    if (cov && cov.location) return canonicalBranchLabel(cov.location);
  }

  const rawCity = String(consumer?.postcodeLevel3 ?? consumer?.postcodeLevel2 ?? '').trim().toLowerCase();
  const rawState = String(consumer?.postcodeLevel1 ?? '').trim().toLowerCase();
  if (rawCity) {
    // Explicit overrides first — city+state, then city alone.
    if (rawState && CITY_BRANCH_OVERRIDES[`${rawCity}|${rawState}`]) {
      return canonicalBranchLabel(CITY_BRANCH_OVERRIDES[`${rawCity}|${rawState}`]);
    }
    if (CITY_BRANCH_OVERRIDES[rawCity]) {
      return canonicalBranchLabel(CITY_BRANCH_OVERRIDES[rawCity]);
    }
    // Loose match against zip coverage table.
    for (const entry of Object.values(ZIP_COVERAGE)) {
      if (String(entry.city).trim().toLowerCase() === rawCity) {
        return canonicalBranchLabel(entry.location);
      }
    }
  }
  return '';
}

/**
 * Map a ServicePower "Warranty Info" (raw label or code) to the AHS Warranty
 * Type the rest of the system uses. Mirrors the mapping in
 * src/routes/ticket.$ticketNo.tsx so list and detail stay in sync.
 *  - Sales fulfillment   -> In warranty
 *  - Concessions         -> Concession LP
 *  - Service Contract    -> In warranty
 *  - Out of warranty     -> Out-of-warranty
 *  - In warranty         -> In warranty
 */
function mapServicePowerWarrantyToAhs(spWarranty: string | undefined | null): string {
  const v = (spWarranty || '').trim().toLowerCase();
  if (!v) return '';
  if (v.includes('sales fulfillment')) return 'In warranty';
  if (v.includes('concession')) return 'Concession LP';
  if (v.includes('service contract')) return 'In warranty';
  if (v.includes('out of warranty') || v.includes('out-of-warranty')) return 'Out-of-warranty';
  if (v.includes('in warranty')) return 'In warranty';
  return spWarranty || '';
}

/**
 * Compact acronym for the ticket-list "Wty" column. Mirrors the acronym used
 * in the ticket detail header ribbon so list and detail stay in sync.
 *  - In Warranty       -> IW
 *  - Out of Warranty   -> OOW
 *  - Service Contract  -> SC
 *  - Concession LP     -> CLP   (etc.)
 */
function warrantyAcronymFromLabel(label: string | null | undefined): string {
  const v = (label || '').trim().toLowerCase();
  if (!v) return '';
  if (v === 'in warranty') return 'IW';
  if (v.includes('out of warranty') || v.includes('out-of-warranty')) return 'OOW';
  if (v === 'concession l') return 'CL';
  if (v === 'concession lp') return 'CLP';
  if (v === 'concession p') return 'CP';
  if (v.includes('ext labor')) return 'ELW';
  if (v.includes('ext part')) return 'EPW';
  if (v.includes('ext wty')) return 'EW';
  if (v.includes('labor only')) return 'LOW';
  if (v.includes('part only')) return 'POW';
  if (v.includes('special part')) return 'SP5';
  if (v.includes('service contract')) return 'SC';
  if (v === 'unknown') return 'UNK';
  return label!.toUpperCase();
}

/**
 * Convert a ServicePower call to local Ticket format
 */
export function convertCallToTicket(call: any): Ticket {
  const consumer = call.consumer || {};
  const product = call.product || {};

  // ServicePower sends "0" or blank for missing phones; treat as empty.
  const cleanPhone = (v: any) => {
    const s = String(v ?? '').trim();
    return s === '0' || s === '' ? '' : s;
  };
  const fullName = `${consumer.firstName || ''} ${consumer.lastName || ''}`.trim();
  // City lives in PostcodeLevel3 (Level2 is usually blank); fall back to Level2.
  const city = consumer.postcodeLevel3 || consumer.postcodeLevel2 || '';
  // Work-order Source (SQUARE TRADE / GE / ASSURANT ...): SP exposes both a
  // MfgId code and (sometimes) a friendlier MfgName. Prefer the name.
  const source = mapSource(call.mfgId, call.mfgName);
  // Servicer account = the credential we authenticated to ServicePower with
  // (e.g. GSL00002). Same value for every SP-sourced ticket. Falls back to
  // whatever SP echoed in ServicerAccount when the env var isn't available.
  const servicerAccount =
    (import.meta as any).env?.VITE_SERVICEPOWER_SERVICER_ACCOUNT ||
    (import.meta as any).env?.VITE_SERVICEPOWER_USER_ID ||
    call.servicerAccount ||
    '';
  // Warranty: ServicePower returns either a code (SC/IW/OW) or a long label
  // ("Service Contract", "In Warranty"). First normalize into a readable label,
  // then map to the AHS warranty type so things like "Service Contract" become
  // "In warranty" — same rule used in the ticket detail page.
  const warrantyType = mapWarrantyType(call.warrantyType);
  const ahsWarranty = mapServicePowerWarrantyToAhs(warrantyType || call.warrantyType);

  // ServicePower puts the service location TYPE ("In Home", "Drop Off") in
  // serviceLocation; that's NOT a branch and we don't want it leaking into
  // the ticket-list "Loc" column. Resolve the branch from the customer's zip
  // using ZIP_COVERAGE (with a city fallback). When nothing matches we leave
  // location empty so the row is visibly unmapped instead of being labelled
  // with the SP service-location type.
  const resolvedBranch = resolveBranchFromCustomer(consumer);
  const ticketLocation = resolvedBranch || '';

  // State: prefer SP's PostcodeLevel1 (normalised to a 2-letter code), then
  // fall back to the state of the resolved branch (so a San Antonio ticket
  // always carries TX even if SP didn't echo a state).
  const spState = normalizeStateCode(consumer.postcodeLevel1);
  const branchState = resolvedBranch
    ? BRANCH_STATE[resolvedBranch.replace(/\s+/g, '').toLowerCase()] || ''
    : '';
  const finalState = spState || branchState;

  return {
    // Core ticket fields
    ticketNo: call.callNumber || '',
    // Ticket Source on the list = claim company (e.g. CENTRICITY, SQUARE TRADE).
    // We derive it from the ServicePower MfgId; falls back to a generic label.
    ticketSource: source || 'ServicePower',
    // Wty = AHS warranty long label (e.g. "In warranty"). The list and detail
    // header ribbon convert to acronym (IW / SC / OOW) at render time.
    warranty: ahsWarranty,
    manufacturer: product.brandDesc || '',
    customer: fullName,
    city,
    location: ticketLocation,
    model: product.modelNo || '',
    internalNote: call.problemDesc || '',
    problemDescription: call.problemDesc || '',
    diagnosed: call.problemDesc || '',
    technician: call.techKey || '',
    // SP's ScheduleTimePeriod is the appointment window string (e.g.
    // "08:00 - 12:00 MORNING") and belongs on Ticket.schedulePeriod —
    // it was previously mis-mapped to customerPref (a boolean column)
    // which silently dropped the value before it ever hit Supabase.
    customerPref: '',
    schedulePeriod: call.scheduleTimePeriod || '',
    // Work Planner buckets tickets into time-frame slots (8-12, 1-5, etc.).
    // Normalise SP's raw window string here so the planner column the
    // ticket lands in matches the actual appointment, not ANYTIME.
    timeSlot: normalizeTimePeriod(call.scheduleTimePeriod || '') || 'ANYTIME',
    schedule: formatServicePowerDate(call.scheduleDate),
    // AHS Repair Status: assigned at first import based on source. NSA tickets
    // start at CSR-Needs Scheduling, everything else at CSR-Assigned to ASC.
    // The raw ServicePower call status (ACCEPTED / etc.) lives in callStatus
    // on the ticket detail's Call Service Information section.
    status: initialAhsStatusForCall(call, source),
    phone: cleanPhone(consumer.phone1),
    redo: /^y/i.test(String(call.repeatCall || '')) ? 'Yes' : '',
    aging: 0,
    calls: 0,
    partOrder: '',
    created: formatServicePowerDate(call.callCreatedOn),
    
    // The header-summary "Account" line on the ticket detail page reads from
    // ticket.account. Per business rule that line shows the Work Order Source
    // (claim company), e.g. "AIG WARRANTY" / "SQUARE TRADE", NOT the servicer
    // credential. The actual servicer account (GSL00002) lives on the
    // ticket detail's Call Service Information section under "Account No",
    // sourced from accountNo on the central ticket map.
    account: source || servicerAccount,
    accountNo: servicerAccount || '',
    type: product.productDesc || '',
    branch: '',
    contact: fullName,
    firstName: consumer.firstName || '',
    lastName: consumer.lastName || '',
    address: consumer.address1 || '',
    address2: consumer.address2 || '',
    zip: consumer.postcode || '',
    state: finalState,
    email: consumer.email || '',
    secondPhone: cleanPhone(consumer.phone2) || cleanPhone(consumer.cellPhone),
    serial: (product.serialNo || '').trim(),
    modelVersion: product.modelNo || '',
    productType: product.productDesc || '',
    purchaseDate: formatServicePowerDate(product.installDate),
    claimCompany: source,
    callReceivedDate: formatServicePowerDate(call.callCreatedOn),
    
    // Parts placeholder
    parts: [],
  };
}

/**
 * Sync ServicePower calls to local ticket storage
 * 
 * @param fromDate - Start date in YYYYMMDD format (defaults to 7 days ago)
 * @param toDate - End date in YYYYMMDD format (defaults to today)
 * @param mergeStrategy - 'replace' to replace all tickets, 'merge' to add/update only
 * @returns Sync results
 */
export async function syncServicePowerCalls(
  fromDate?: string,
  toDate?: string,
  mergeStrategy: 'replace' | 'merge' = 'merge'
): Promise<{ 
  success: boolean; 
  tickets: Ticket[]; 
  added: number; 
  updated: number; 
  errors?: string[] 
}> {
  // Default to last 7 days if no date range provided
  if (!fromDate) {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    fromDate = date.toISOString().split('T')[0].replace(/-/g, '');
  }
  
  if (!toDate) {
    toDate = new Date().toISOString().split('T')[0].replace(/-/g, '');
  }

  const result = await fetchServicePowerCalls({ fromDate, toDate });

  if (!result.success) {
    const errorMsg = typeof result.error === 'string' 
      ? result.error 
      : result.error?.description || result.error?.message || JSON.stringify(result.error) || 'Failed to fetch calls';
    
    return {
      success: false,
      tickets: [],
      added: 0,
      updated: 0,
      errors: [errorMsg],
    };
  }

  if (!result.calls || result.calls.length === 0) {
    // Surface a snippet of the raw response so we can diagnose why parsing found nothing
    const snippet = result.rawXml ? String(result.rawXml).substring(0, 800) : 'No XML returned';
    return {
      success: true,
      tickets: [],
      added: 0,
      updated: 0,
      errors: [`No calls parsed. Raw response snippet: ${snippet}`],
    };
  }

  // Convert calls to tickets
  const servicePowerTickets = result.calls.map(convertCallToTicket);

  // Get existing tickets
  const existingTicketsJson = localStorage.getItem('ahs:tickets:data');
  const existingTickets: Ticket[] = existingTicketsJson ? JSON.parse(existingTicketsJson) : [];

  let finalTickets: Ticket[];
  let added = 0;
  let updated = 0;

  if (mergeStrategy === 'replace') {
    // Replace all tickets with ServicePower data
    finalTickets = servicePowerTickets;
    added = servicePowerTickets.length;
  } else {
    // Merge: update existing, add new
    const existingMap = new Map(existingTickets.map(t => [t.ticketNo, t]));
    
    servicePowerTickets.forEach(spTicket => {
      if (existingMap.has(spTicket.ticketNo)) {
        // Update existing ticket
        existingMap.set(spTicket.ticketNo, {
          ...existingMap.get(spTicket.ticketNo),
          ...spTicket,
          // Preserve local-only fields
          visits: existingMap.get(spTicket.ticketNo)?.visits,
          statusChangedAt: existingMap.get(spTicket.ticketNo)?.statusChangedAt,
          statusChangedBy: existingMap.get(spTicket.ticketNo)?.statusChangedBy,
        });
        updated++;
      } else {
        // Add new ticket
        existingMap.set(spTicket.ticketNo, spTicket);
        added++;
      }
    });

    finalTickets = Array.from(existingMap.values());
  }

  // Save to localStorage
  localStorage.setItem('ahs:tickets:data', JSON.stringify(finalTickets));
  
  // Trigger storage event for other components to refresh
  window.dispatchEvent(new StorageEvent('storage', {
    key: 'ahs:tickets:data',
    newValue: JSON.stringify(finalTickets),
    url: window.location.href
  }));

  return {
    success: true,
    tickets: servicePowerTickets,
    added,
    updated,
  };
}

/**
 * Determine whether a ServicePower call has an "Accepted" status.
 * ServicePower reports status text like "ACCEPTED" or "ACCEPTED / ACCEPTED".
 */
export function isAcceptedCall(call: any): boolean {
  const status = String(call?.callStatus ?? "").toLowerCase();
  return status.includes("accept");
}

/**
 * Sync-eligible statuses: Accepted, Completed, Cancelled. ServicePower may
 * concatenate them like "ACCEPTED / ACCEPTED" or "COMPLETED" so substring
 * matching is enough.
 */
function isSyncableCall(call: any): boolean {
  const status = String(call?.callStatus ?? "").toLowerCase();
  return (
    status.includes("accept") ||
    status.includes("complete") ||
    status.includes("cancel")
  );
}

/** Format a Date as ServicePower expects: mm/dd/yyyy HH:mm:ss. */
function formatSpDateTime(date: Date, endOfDay = false): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yyyy = date.getFullYear();
  const time = endOfDay ? "23:59:59" : "00:00:00";
  return `${mm}/${dd}/${yyyy} ${time}`;
}

/**
 * Sync ServicePower work orders directly into Supabase.
 *
 * ServicePower limits each query to a 2-day window (error SP007), so the
 * requested range is split into <=2-day chunks and fetched sequentially.
 * Only work orders with an "Accepted" status are synced. For each accepted
 * call we upsert the customer + ticket (source, customer details, address,
 * product details, work order details). Local-only data (visits, parts,
 * billing) is preserved on updates. De-duplicates by call number across chunks.
 *
 * @param days Number of days back from today to sync (default 7).
 * @param options.limit Max number of Accepted work orders to upsert (for testing).
 * @param options.locationFilter Single AHS branch label (e.g. "San Antonio").
 *   Kept for back-compat; if `locationFilters` is also set the array wins.
 * @param options.locationFilters Multiple AHS branch labels. Only calls whose
 *   customer zip resolves to one of these branches via ZIP_COVERAGE (with a
 *   city-name fallback) are kept. Mirrors the branches the ticket list filters
 *   on, so anything synced shows up under the right branch.
 * @param options.zipFilter 5-digit zip OR zip prefix (e.g. "78666" or "786").
 *   When set, only calls whose customer postcode starts with this value are
 *   kept. Combines with locationFilters (both must match).
 * @param options.coveredOnly When true, only keep calls whose customer zip
 *   appears in ZIP_COVERAGE (i.e. falls inside one of our branch service
 *   areas). Use this to avoid pulling calls outside our coverage map.
 * @param options.startDate Explicit start of the sync window (ISO yyyy-mm-dd
 *   or a Date). When set, `days` is ignored and the window walks forward from
 *   this date up to today in <=2-day chunks. Use this for a fixed-start
 *   backfill (e.g. "2026-06-01" to present).
 * @param options.skipTicketNos Set of call numbers already in the local DB.
 *   Calls matching these are dropped before upsert so we don't burn write
 *   quota touching tickets we already have. The hourly auto-sync uses this
 *   so a repeated run is effectively "new tickets only".
 */
export async function syncServicePowerToSupabase(
  days = 7,
  options: {
    limit?: number;
    locationFilter?: string;
    locationFilters?: string[];
    zipFilter?: string;
    coveredOnly?: boolean;
    startDate?: string | Date;
    skipTicketNos?: Set<string> | string[];
  } = {}
): Promise<{
  success: boolean;
  added: number;
  updated: number;
  skipped: number;
  total: number;
  errors: string[];
}> {
  const { upsertTicketFromServicePower } = await import("./supabase/tickets");
  const { limit, locationFilter, locationFilters, zipFilter, coveredOnly, startDate, skipTicketNos } = options;
  // Combine the two location-filter shapes into a normalised set we can match
  // against. Empty set = no branch scoping.
  const branchSet = new Set<string>();
  for (const v of locationFilters ?? []) {
    const t = String(v ?? "").trim();
    if (t) branchSet.add(t.toLowerCase());
  }
  if (locationFilter && String(locationFilter).trim()) {
    branchSet.add(String(locationFilter).trim().toLowerCase());
  }
  const zipNeedle = (zipFilter || "").trim().replace(/\D/g, "");
  const skipSet: Set<string> = skipTicketNos instanceof Set
    ? new Set([...skipTicketNos].map((v) => String(v).trim()))
    : new Set((skipTicketNos ?? []).map((v) => String(v).trim()));

  const errors: string[] = [];
  const seenCallNumbers = new Set<string>();
  const acceptedCalls: any[] = [];
  let totalCalls = 0;
  let filteredOut = 0;

  // Build 2-day windows. If startDate is given, walk FORWARD from that day
  // (in 2-day chunks) up to today. Otherwise walk BACKWARD from today
  // covering `days` days.
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const windows: Array<{ from: Date; to: Date }> = [];

  if (startDate) {
    const start = typeof startDate === "string" ? new Date(startDate + "T00:00:00") : new Date(startDate);
    start.setHours(0, 0, 0, 0);
    let from = new Date(start);
    while (from <= today) {
      const to = new Date(from);
      to.setDate(to.getDate() + 1); // 2-day inclusive window
      if (to > today) to.setTime(today.getTime());
      windows.push({ from: new Date(from), to: new Date(to) });
      from = new Date(to);
      from.setDate(from.getDate() + 1);
    }
  } else {
    let cursor = new Date(today);
    let remaining = Math.max(1, days);
    while (remaining > 0) {
      const chunk = Math.min(2, remaining);
      const to = new Date(cursor);
      const from = new Date(cursor);
      from.setDate(from.getDate() - (chunk - 1));
      windows.push({ from, to });
      cursor = new Date(from);
      cursor.setDate(cursor.getDate() - 1);
      remaining -= chunk;
    }
  }

  for (const win of windows) {
    // Stop fetching more windows once we've collected enough for the limit.
    if (limit != null && acceptedCalls.length >= limit) break;

    const fromStr = formatSpDateTime(win.from, false);
    const toStr = formatSpDateTime(win.to, true);
    const result = await fetchServicePowerCalls({ fromDate: fromStr, toDate: toStr });

    if (!result.success) {
      const errorMsg =
        typeof result.error === "string"
          ? result.error
          : result.error?.description || result.error?.message || "Failed to fetch calls";
      errors.push(`${fromStr} - ${toStr}: ${errorMsg}`);
      continue;
    }

    for (const call of result.calls ?? []) {
      totalCalls++;
      const callNo = String(call?.callNumber ?? "");
      if (callNo && seenCallNumbers.has(callNo)) continue;
      if (callNo) seenCallNumbers.add(callNo);
      // Skip tickets already in the local DB so an "incremental" sync only
      // touches new calls. Avoids overwriting fields that may have been
      // edited by users and saves SP API + Supabase writes.
      if (callNo && skipSet.size && skipSet.has(callNo)) {
        filteredOut++;
        continue;
      }
      if (!isSyncableCall(call)) continue;

      // Optional location / zip / coverage scoping. SP's getCallInfoSearch
      // SOAP op only supports date and call number filters, so we filter the
      // parsed calls client-side. Branch is derived from the customer's zip
      // using the same ZIP_COVERAGE table the rest of the app uses.
      if (branchSet.size || zipNeedle || coveredOnly) {
        const consumer = call?.consumer ?? {};
        const rawZip = String(consumer.postcode ?? '').trim().replace(/\D/g, '');
        const zip5 = (rawZip.match(/\d{5}/) || [''])[0];

        if (zipNeedle && !rawZip.startsWith(zipNeedle)) {
          filteredOut++;
          continue;
        }

        const branch = (branchSet.size || coveredOnly)
          ? resolveBranchFromCustomer(consumer)
          : '';

        if (coveredOnly && !branch && !(zip5 && lookupZip(zip5))) {
          filteredOut++;
          continue;
        }

        if (branchSet.size && !branchSet.has(branch.toLowerCase())) {
          filteredOut++;
          continue;
        }
      }

      if (limit == null || acceptedCalls.length < limit) {
        acceptedCalls.push(call);
      }
    }
  }

  let added = 0;
  let updated = 0;

  for (const call of acceptedCalls) {
    try {
      const ticket = convertCallToTicket(call);
      const outcome = await upsertTicketFromServicePower(ticket);
      if (outcome === "added") added++;
      else updated++;
    } catch (err) {
      errors.push(
        `Call ${call?.callNumber ?? "(unknown)"}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const skipped = totalCalls - acceptedCalls.length;

  return {
    success: errors.length === 0,
    added,
    updated,
    skipped,
    total: totalCalls,
    errors: branchSet.size || zipNeedle || coveredOnly
      ? [
          `Filtered out ${filteredOut} calls outside${branchSet.size ? ` branches [${[...branchSet].join(', ')}]` : ''}${zipNeedle ? ` zip "${zipFilter}"` : ''}${coveredOnly ? ' coverage area' : ''}.`,
          ...errors,
        ]
      : errors,
  };
}

/**
 * Get date range for last N days in ServicePower format (YYYYMMDD)
 */
export function getDateRange(days: number): { fromDate: string; toDate: string } {
  const today = new Date();
  const pastDate = new Date(today);
  pastDate.setDate(today.getDate() - days);

  const formatDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  };

  return {
    fromDate: formatDate(pastDate),
    toDate: formatDate(today)
  };
}
