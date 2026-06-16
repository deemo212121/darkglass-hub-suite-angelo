/**
 * ServicePower SOAP Sync - Pull Calls and Convert to Tickets
 * 
 * This module fetches calls from ServicePower SOAP API and converts them
 * to your local ticket format for display in the ticket list.
 */

import type { Ticket } from './ticketData';
import { parseGetCallInfoResponse, formatServicePowerDate } from './servicePowerSoapParser';

/**
 * Fetch calls from ServicePower SOAP API by date range
 */
export async function fetchServicePowerCalls(params: {
  fromDate?: string; // Format: YYYYMMDD
  toDate?: string;   // Format: YYYYMMDD
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
 * Convert a ServicePower call to local Ticket format
 */
export function convertCallToTicket(call: any): Ticket {
  const consumer = call.consumer || {};
  const product = call.product || {};

  return {
    // Core ticket fields
    ticketNo: call.callNumber || '',
    ticketSource: 'ServicePower',
    warranty: product.brandDesc || '',
    manufacturer: product.brandDesc || '',
    customer: call.serviceCenter || '',
    city: consumer.postcodeLevel2 || '',
    location: call.serviceLocation || '',
    model: product.modelNo || '',
    internalNote: call.problemDesc || '',
    diagnosed: call.problemDesc || '',
    technician: call.techKey || '',
    customerPref: call.scheduleTimePeriod || '',
    schedule: formatServicePowerDate(call.scheduleDate),
    status: call.callStatus || '',
    phone: consumer.phone1 || '',
    redo: call.repeatCall === 'Y' ? 'Yes' : '',
    aging: 0,
    calls: 0,
    partOrder: '',
    created: formatServicePowerDate(call.callCreatedOn),
    
    // Additional detail fields
    account: call.fssCallId || call.callNumber,
    type: product.productDesc || '',
    branch: '',
    contact: `${consumer.firstName || ''} ${consumer.lastName || ''}`.trim(),
    firstName: consumer.firstName || '',
    lastName: consumer.lastName || '',
    address: consumer.address1 || '',
    zip: consumer.postcode || '',
    state: consumer.postcodeLevel1 || '',
    email: consumer.email || '',
    secondPhone: consumer.phone2 || consumer.cellPhone || '',
    serial: product.serialNo || '',
    modelVersion: product.modelNo || '',
    productType: product.productDesc || '',
    purchaseDate: formatServicePowerDate(product.installDate),
    claimCompany: product.brandDesc || '',
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
