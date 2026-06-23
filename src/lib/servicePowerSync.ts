/**
 * ServicePower SOAP Sync - Pull Calls and Convert to Tickets
 * 
 * This module fetches calls from ServicePower SOAP API and converts them
 * to your local ticket format for display in the ticket list.
 */

import type { Ticket } from './ticketData';
import { parseGetCallInfoResponse, formatServicePowerDate } from './servicePowerSoapParser';

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
 * (e.g. I565 = SQUARE TRADE, I455 = ASSURANT SOLUTIONS). Falls back to the
 * raw code when unknown.
 */
const MFG_ID_SOURCE: Record<string, string> = {
  I565: 'SQUARE TRADE',
  I455: 'ASSURANT SOLUTIONS',
  B100: 'CENTRICITY',
};
function mapSource(mfgId: string | null | undefined): string {
  const code = String(mfgId ?? '').trim().toUpperCase();
  return MFG_ID_SOURCE[code] || code || '';
}

/**
 * Decide the initial AHS Repair Status for a ticket newly imported from
 * ServicePower. Based on the work-order Source:
 *  - NSA (any variant)  -> "CSR-Needs Scheduling"
 *  - everything else    -> "CSR-Assigned to ASC"
 *
 * NOTE: this is only used on first insert. On subsequent re-syncs the local
 * status set by AHS users (e.g. CSR-Acknowledged once a CSR clicks Acknowledge)
 * is preserved by upsertTicketFromServicePower so we never clobber it.
 */
function initialAhsStatusForSource(source: string): string {
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
  // Work-order Source (SQUARE TRADE / ASSURANT ...) is encoded in MfgId.
  const source = mapSource(call.mfgId);
  // Warranty: ServicePower returns either a code (SC/IW/OW) or a long label
  // ("Service Contract", "In Warranty"). First normalize into a readable label,
  // then map to the AHS warranty type so things like "Service Contract" become
  // "In warranty" — same rule used in the ticket detail page.
  const warrantyType = mapWarrantyType(call.warrantyType);
  const ahsWarranty = mapServicePowerWarrantyToAhs(warrantyType || call.warrantyType);

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
    location: call.serviceLocation || '',
    model: product.modelNo || '',
    internalNote: call.problemDesc || '',
    problemDescription: call.problemDesc || '',
    diagnosed: call.problemDesc || '',
    technician: call.techKey || '',
    customerPref: call.scheduleTimePeriod || '',
    schedule: formatServicePowerDate(call.scheduleDate),
    // AHS Repair Status: assigned at first import based on source. NSA tickets
    // start at CSR-Needs Scheduling, everything else at CSR-Assigned to ASC.
    // The raw ServicePower call status (ACCEPTED / etc.) lives in callStatus
    // on the ticket detail's Call Service Information section.
    status: initialAhsStatusForSource(source),
    phone: cleanPhone(consumer.phone1),
    redo: /^y/i.test(String(call.repeatCall || '')) ? 'Yes' : '',
    aging: 0,
    calls: 0,
    partOrder: '',
    created: formatServicePowerDate(call.callCreatedOn),
    
    // Additional detail fields
    account: source,
    type: product.productDesc || '',
    branch: '',
    contact: fullName,
    firstName: consumer.firstName || '',
    lastName: consumer.lastName || '',
    address: consumer.address1 || '',
    address2: consumer.address2 || '',
    zip: consumer.postcode || '',
    state: consumer.postcodeLevel1 || '',
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
 */
export async function syncServicePowerToSupabase(
  days = 7,
  options: { limit?: number } = {}
): Promise<{
  success: boolean;
  added: number;
  updated: number;
  skipped: number;
  total: number;
  errors: string[];
}> {
  const { upsertTicketFromServicePower } = await import("./supabase/tickets");
  const { limit } = options;

  const errors: string[] = [];
  const seenCallNumbers = new Set<string>();
  const acceptedCalls: any[] = [];
  let totalCalls = 0;

  // Build 2-day windows walking backward from today.
  const today = new Date();
  const windows: Array<{ from: Date; to: Date }> = [];
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
      if (isAcceptedCall(call)) {
        if (limit == null || acceptedCalls.length < limit) {
          acceptedCalls.push(call);
        }
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
    errors,
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
