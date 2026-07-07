/**
 * Centralized Ticket Data
 * 
 * This file contains all dummy ticket data used across the platform.
 * Import and use these tickets in:
 * - Work Map
 * - Work Planner
 * - Ticket Details
 * - Ticket List
 * - Claims Calendar
 * - Any other ticket-related components
 */

export interface Ticket {
  ticketNo: string;
  ticketSource?: string;
  warranty: string;
  manufacturer: string;
  customer: string;
  city: string;
  location: string;
  model: string;
  internalNote: string;
  problemDescription?: string;
  diagnosed: string;
  technician: string;
  customerPref: string;
  schedule: string;
  /**
   * ServicePower's appointment-time window for the call.
   * Sourced from `ScheduleTimePeriod` on getCallInfo and persisted as
   * `tickets.time_slot`. Examples: "08:00 - 12:00 MORNING",
   * "12:00 - 17:00 AFTERNOON".
   */
  schedulePeriod?: string;
  /**
   * Canonical Work Planner slot label for the appointment window
   * (e.g. "8-12", "1-5", "ANYTIME"). Persisted alongside
   * `schedulePeriod` on `tickets.time_slot` after being run through
   * `normalizeTimePeriod` at sync time. UI code that already reads
   * `row.timeSlot` (Work Planner) keeps working.
   */
  timeSlot?: string;
  status: string;
  phone: string;
  redo: string;
  aging: number;
  calls: number;
  partOrder: string;
  created: string;
  statusChangedAt?: string;
  statusChangedBy?: string;
  // Additional fields for ticket details
  account?: string;
  /** ServicePower servicer credential (e.g. "GSL00002") used to authenticate
   * to the SOAP API. Distinct from `account`, which holds the Work Order
   * Source / claim company on a ticket-detail header. */
  accountNo?: string;
  irKit?: string;
  type?: string;
  branch?: string;
  contact?: string;
  delay?: number;
  // Customer details
  firstName?: string;
  lastName?: string;
  address?: string;
  address2?: string;
  zip?: string;
  state?: string;
  email?: string;
  secondPhone?: string;
  /** Alternate contact number (in addition to home + cell). Persisted on
   * customers.alt_phone via migration 0021. */
  altPhone?: string;
  // Product details
  serial?: string;
  modelVersion?: string;
  productType?: string;
  purchaseDate?: string;
  // Additional tracking fields
  fakeTicket?: boolean;
  originalTicketNo?: string;
  callReceivedDate?: string;
  addressNote?: string;
  claimCompany?: string;
  // Service tracking data - visits and parts integrated into ticket
  visits?: Array<{
    id: string;
    visitNo: string;
    timestamp: string;
    updatedAt?: string;
    updatedBy?: string;
    updateReason?: string;
    by: string;
    scheduleDate: string;
    technician: string;
    timeSlot: string;
    activity: string;
    actionType: string;
    repairStatus: string;
    repairType: string;
    schedNotes: string;
    reclaim: string;
    visited: string;
    notCompleted: string;
    symptomCx: string;
    diagnosis: string;
    symptomTech: string;
    resolution: string;
    nonCompletionReason: string;
    triageNote: string;
    status: string;
    note: string;
  }>;
  parts?: Array<{
    id: string;
    partNo: string;
    partDist: string;
    partDesc: string;
    poNo: string;
    poDate: string;
    invoiceNo: string;
    invoiceDate: string;
    quantity: string;
    partPrice: string;
    coreValue: string;
    shipCost: string;
    markup: string;
    totalMarkup: string;
    claimTo: string;
    status: string;
    note: string;
    visitId: string;
    orderNo: string;
    eta: string;
    inTracking: string;
    raDate: string;
    raNo: string;
    outTracking: string;
    creditNo: string;
    hold: string;
    cxPaid: string;
    createdBy: string;
    lastModifiedBy: string;
  }>;
  alertMessages?: Array<{
    id: string;
    text: string;
    by: string;
    timestamp: string;
  }>;
}

export const TICKET_SOURCES = [
  "LG",
  "Midea-104268",
  "NSA GSLEE",
  "NSA MEMPHIS",
  "SB",
  "SB-1276506820",
  "SB-Miele",
  "SP",
  "SP1",
  "SS",
  "SS-6488757",
  "EarlyRepair",
] as const;

export const REPAIR_STATUS_OPTIONS = [
  "CL-Need Cancel",
  "CL-Parts Back Ordered",
  "CL-Ready to Complete",
  "CSR-Acknowledged",
  "CSR-Assigned to ASC",
  "CSR-Left Message for Cx",
  "CSR-Needs Scheduling",
  "OP-Ready for Service",
  "OP-Reschedule Follow up",
  "OP-UPDATE HOLD",
  "OP-Waiting for Part",
  "PT-Need PreAuthorization",
  "TR-Need PO",
  "TR-Need Triage",
] as const;

/**
 * Raw ticket data without ticket sources
 */
const RAW_TICKETS: Omit<Ticket, "ticketSource">[] = [
  {
    ticketNo: "SA-3458831",
    warranty: "IW",
    account: "GSL00002",
    manufacturer: "IH",
    customer: "Neal Market",
    city: "GREENSBORO",
    location: "Atlanta",
    model: "GNE27JYMFFS",
    internalNote: "",
    irKit: "",
    type: "SMS",
    branch: "",
    diagnosed: "N",
    technician: "",
    customerPref: "N",
    contact: "",
    schedule: "05/21/26",
    status: "CSR-Assigned to ASC",
    delay: 0,
    phone: "706.817.2900",
    redo: "N",
    aging: 0,
    calls: 0,
    partOrder: "Not Diagnosed",
    created: "05/18/26",
    firstName: "NEAL",
    lastName: "MARKET",
    address: "123 Main St",
    zip: "30642",
  },
  {
    ticketNo: "26000679102DF",
    warranty: "IW",
    account: "GSL00002",
    manufacturer: "IH",
    customer: "Brian Rowe",
    city: "SHADY DALE",
    location: "Atlanta",
    model: "FCRE3083AS",
    internalNote: "",
    irKit: "",
    type: "SMS",
    branch: "",
    diagnosed: "N",
    technician: "",
    customerPref: "N",
    contact: "",
    schedule: "05/19/26",
    status: "CSR-Assigned to ASC",
    delay: 1,
    phone: "706.366.1043",
    redo: "N",
    aging: 1,
    calls: 0,
    partOrder: "Not Diagnosed",
    created: "05/17/26",
    firstName: "BRIAN",
    lastName: "ROWE",
    address: "456 Oak Ave",
    zip: "31085",
  },
  {
    ticketNo: "1007208750-10",
    warranty: "IW",
    account: "GSL00002",
    manufacturer: "IH",
    customer: "Charles Mcdonald",
    city: "GREENSBORO",
    location: "Atlanta",
    model: "FRUF2020AW",
    internalNote: "",
    irKit: "",
    type: "SMS",
    branch: "",
    diagnosed: "N",
    technician: "",
    customerPref: "N",
    contact: "",
    schedule: "05/19/26",
    status: "CSR-Assigned to ASC",
    delay: 1,
    phone: "404.680.4022",
    redo: "N",
    aging: 1,
    calls: 0,
    partOrder: "Not Diagnosed",
    created: "05/17/26",
    firstName: "CHARLES",
    lastName: "MCDONALD",
    address: "789 Elm St",
    zip: "30642",
  },
  {
    ticketNo: "027360174134",
    warranty: "IW",
    account: "GSL00002",
    manufacturer: "IH",
    customer: "Lauren Santori",
    city: "TEMPLE",
    location: "Atlanta",
    model: "NE63A6511SS",
    internalNote: "",
    irKit: "",
    type: "SMS",
    branch: "",
    diagnosed: "N",
    technician: "",
    customerPref: "N",
    contact: "",
    schedule: "05/20/26",
    status: "CSR-Assigned to ASC",
    delay: 1,
    phone: "770.820.1665",
    redo: "N",
    aging: 1,
    calls: 0,
    partOrder: "Not Diagnosed",
    created: "05/17/26",
    firstName: "LAUREN",
    lastName: "SANTORI",
    address: "321 Pine Rd",
    zip: "30179",
  },
  {
    ticketNo: "26000671769DF1",
    warranty: "IW",
    account: "GSL00002",
    manufacturer: "IH",
    customer: "Rose Phillips",
    city: "ELLENWOOD",
    location: "Atlanta",
    model: "DV45K7600EW",
    internalNote: "",
    irKit: "",
    type: "SMS",
    branch: "",
    diagnosed: "Y",
    technician: "Nathan Napora",
    customerPref: "Y",
    contact: "",
    schedule: "05/18/26",
    status: "OP-Waiting for Part",
    delay: 3,
    phone: "404.640.7141",
    redo: "Y",
    aging: 3,
    calls: 0,
    partOrder: "Part Ordered",
    created: "05/15/26",
    firstName: "ROSE",
    lastName: "PHILLIPS",
    address: "555 Maple Dr",
    zip: "30294",
  },
  {
    ticketNo: "7039321404BL-13",
    warranty: "IW",
    account: "ER",
    manufacturer: "IH",
    customer: "Melissa Beaver",
    city: "EATONTON",
    location: "Atlanta",
    model: "GCCE3670AS",
    internalNote: "WF 05/15 waiting for parts tracking",
    irKit: "",
    type: "SMS",
    branch: "",
    diagnosed: "Y",
    technician: "Joshua Silva",
    customerPref: "N",
    contact: "",
    schedule: "05/15/26",
    status: "OP-Waiting for Part",
    delay: 4,
    phone: "703.932.1404",
    redo: "Y",
    aging: 4,
    calls: 0,
    partOrder: "Partially Ordered",
    created: "05/14/26",
    firstName: "MELISSA",
    lastName: "BEAVER",
    address: "888 Cedar Ln",
    zip: "31024",
  },
  {
    ticketNo: "SA-3433383",
    warranty: "IW",
    account: "GSL00002",
    manufacturer: "IH",
    customer: "Accent Overlook",
    city: "CANTON",
    location: "Atlanta",
    model: "GDT535PSRSS",
    internalNote: "",
    irKit: "",
    type: "SMS",
    branch: "",
    diagnosed: "N",
    technician: "",
    customerPref: "Y",
    contact: "",
    schedule: "05/18/26",
    status: "CSR-Left Message for Cx",
    delay: 4,
    phone: "770.766.0064",
    redo: "N",
    aging: 4,
    calls: 2,
    partOrder: "Not Diagnosed",
    created: "05/14/26",
    firstName: "ACCENT",
    lastName: "OVERLOOK",
    address: "999 Hillside Ct",
    zip: "30114",
  },
  {
    ticketNo: "SA-3431358",
    warranty: "IW",
    account: "GSL00002",
    manufacturer: "IH",
    customer: "Evelin Tirado",
    city: "EATONTON",
    location: "Atlanta",
    model: "HDF330PGRBB",
    internalNote: "",
    irKit: "",
    type: "SMS",
    branch: "",
    diagnosed: "N",
    technician: "",
    customerPref: "N",
    contact: "",
    schedule: "05/19/26",
    status: "CSR-Left Message for Cx",
    delay: 4,
    phone: "706.816.6545",
    redo: "N",
    aging: 4,
    calls: 2,
    partOrder: "Not Diagnosed",
    created: "05/14/26",
    firstName: "EVELIN",
    lastName: "TIRADO",
    address: "222 Valley View",
    zip: "31024",
  },
  {
    ticketNo: "3850106E11",
    warranty: "IW",
    account: "GSL00002",
    manufacturer: "IH",
    customer: "Tricon Propertymanager",
    city: "DALLAS",
    location: "Atlanta",
    model: "GTX22EASK1WW",
    internalNote: "WF 05/16 - Sent message to tech",
    irKit: "",
    type: "SMS",
    branch: "",
    diagnosed: "N",
    technician: "Abel Severino",
    customerPref: "N",
    contact: "",
    schedule: "05/15/26",
    status: "OP-UPDATE HOLD",
    delay: 5,
    phone: "678.508.7857",
    redo: "N",
    aging: 5,
    calls: 0,
    partOrder: "Not Diagnosed",
    created: "05/13/26",
    firstName: "TRICON",
    lastName: "PROPERTY",
    address: "111 Property Ln",
    zip: "30132",
  },
  {
    ticketNo: "26000663669DF1",
    warranty: "IW",
    account: "GSL00002",
    manufacturer: "IH",
    customer: "Shirley Gentry",
    city: "TAYLORSVILLE",
    location: "Atlanta",
    model: "MVW7232HW",
    internalNote: "",
    irKit: "",
    type: "SMS",
    branch: "",
    diagnosed: "N",
    technician: "Abel Severino",
    customerPref: "N",
    contact: "",
    schedule: "05/15/26",
    status: "TR-Need Triage",
    delay: 5,
    phone: "770.316.3847",
    redo: "N",
    aging: 5,
    calls: 0,
    partOrder: "Not Diagnosed",
    created: "05/13/26",
    firstName: "SHIRLEY",
    lastName: "GENTRY",
    address: "444 Forest Way",
    zip: "30178",
  },
  {
    ticketNo: "TK-MEMPHIS-001",
    warranty: "IW",
    account: "MEM001",
    manufacturer: "IH",
    customer: "James Anderson",
    city: "MEMPHIS",
    location: "Memphis",
    model: "WM3488HW",
    internalNote: "Priority customer",
    irKit: "",
    type: "Phone",
    branch: "Memphis",
    diagnosed: "Y",
    technician: "Darrin Stewart",
    customerPref: "Y",
    contact: "Y",
    schedule: "06/15/26",
    status: "OP-Ready for Service",
    delay: 0,
    phone: "901.555.0123",
    redo: "N",
    aging: 2,
    calls: 1,
    partOrder: "Part Ordered",
    created: "06/13/26",
    firstName: "JAMES",
    lastName: "ANDERSON",
    address: "100 Beale St",
    zip: "38103",
  },
  {
    ticketNo: "TK-NASHVILLE-001",
    warranty: "OW",
    account: "NASH001",
    manufacturer: "Samsung",
    customer: "Sarah Williams",
    city: "NASHVILLE",
    location: "Nashville",
    model: "RF28R7351SG",
    internalNote: "Out of warranty - quoted $250",
    irKit: "",
    type: "SMS",
    branch: "Nashville",
    diagnosed: "Y",
    technician: "John Godfrey",
    customerPref: "N",
    contact: "Y",
    schedule: "06/16/26",
    status: "CSR-Needs Scheduling",
    delay: 1,
    phone: "615.555.0456",
    redo: "N",
    aging: 3,
    calls: 2,
    partOrder: "Part Ordered",
    created: "06/13/26",
    firstName: "SARAH",
    lastName: "WILLIAMS",
    address: "200 Music Row",
    zip: "37203",
  },
  {
    ticketNo: "TK-BIRMINGHAM-001",
    warranty: "IW",
    account: "BIR001",
    manufacturer: "Whirlpool",
    customer: "Michael Brown",
    city: "BIRMINGHAM",
    location: "Birmingham",
    model: "WED7120HW",
    internalNote: "",
    irKit: "",
    type: "SMS",
    branch: "Birmingham",
    diagnosed: "N",
    technician: "David Sims",
    customerPref: "Y",
    contact: "",
    schedule: "06/17/26",
    status: "CSR-Assigned to ASC",
    delay: 0,
    phone: "205.555.0789",
    redo: "N",
    aging: 1,
    calls: 0,
    partOrder: "Not Diagnosed",
    created: "06/14/26",
    firstName: "MICHAEL",
    lastName: "BROWN",
    address: "300 Highland Ave",
    zip: "35205",
  },
  {
    ticketNo: "TK-JACKSONVILLE-001",
    warranty: "IW",
    account: "JAX001",
    manufacturer: "LG",
    customer: "Emily Davis",
    city: "JACKSONVILLE",
    location: "Jacksonville",
    model: "LRFVS3006S",
    internalNote: "",
    irKit: "",
    type: "Phone",
    branch: "Jacksonville",
    diagnosed: "Y",
    technician: "Bradley Hollowell",
    customerPref: "N",
    contact: "Y",
    schedule: "06/18/26",
    status: "OP-Waiting for Part",
    delay: 2,
    phone: "904.555.0321",
    redo: "N",
    aging: 4,
    calls: 1,
    partOrder: "Part Ordered",
    created: "06/12/26",
    firstName: "EMILY",
    lastName: "DAVIS",
    address: "400 Beach Blvd",
    zip: "32250",
  },
  {
    ticketNo: "TK-LAKECHARLES-001",
    warranty: "IW",
    account: "LC001",
    manufacturer: "Frigidaire",
    customer: "Robert Chance",
    city: "LAKE CHARLES",
    location: "Lake Charles",
    model: "FFRE4120SW",
    internalNote: "",
    irKit: "",
    type: "SMS",
    branch: "Lake Charles",
    diagnosed: "N",
    technician: "Danny Thornton",
    customerPref: "N",
    contact: "Sched.",
    schedule: "N/A",
    status: "CSR-Needs Scheduling",
    delay: 0,
    phone: "337.555.0654",
    redo: "N",
    aging: 1,
    calls: 1,
    partOrder: "Not Diagnosed",
    created: "06/14/26",
    firstName: "ROBERT",
    lastName: "CHANCE",
    address: "500 Lakeshore Dr",
    zip: "70601",
  },
];

/**
 * CENTRALIZED TICKET DATA
 * Use this export in all components that need ticket data
 */
export const TICKETS: Ticket[] = RAW_TICKETS.map((ticket, index) => ({
  ...ticket,
  ticketSource: TICKET_SOURCES[index % TICKET_SOURCES.length],
}));

/**
 * Helper function to get a ticket by ticket number
 */
export function getTicketByNumber(ticketNo: string): Ticket | undefined {
  const allTickets = loadTickets();
  return allTickets.find(t => t.ticketNo === ticketNo);
}

/**
 * Helper function to get tickets by location
 */
export function getTicketsByLocation(location: string): Ticket[] {
  const allTickets = loadTickets();
  return allTickets.filter(t => t.location === location);
}

/**
 * Helper function to get tickets by status
 */
export function getTicketsByStatus(status: string): Ticket[] {
  const allTickets = loadTickets();
  return allTickets.filter(t => t.status === status);
}

/**
 * Helper function to get tickets by technician
 */
export function getTicketsByTechnician(technician: string): Ticket[] {
  const allTickets = loadTickets();
  return allTickets.filter(t => t.technician === technician);
}

/**
 * Helper function to filter tickets
 */
export function filterTickets(filters: {
  search?: string;
  status?: string;
  location?: string;
  technician?: string;
  diagnosed?: string;
}): Ticket[] {
  let filtered = loadTickets();

  if (filters.search) {
    const query = filters.search.toLowerCase();
    filtered = filtered.filter(ticket =>
      ticket.ticketNo.toLowerCase().includes(query) ||
      ticket.customer.toLowerCase().includes(query) ||
      ticket.city.toLowerCase().includes(query) ||
      ticket.phone.includes(query) ||
      ticket.model.toLowerCase().includes(query)
    );
  }

  if (filters.status) {
    filtered = filtered.filter(ticket => ticket.status === filters.status);
  }

  if (filters.location) {
    filtered = filtered.filter(ticket => ticket.location === filters.location);
  }

  if (filters.technician) {
    filtered = filtered.filter(ticket => ticket.technician === filters.technician);
  }

  if (filters.diagnosed) {
    filtered = filtered.filter(ticket => ticket.diagnosed === filters.diagnosed);
  }

  return filtered;
}

/**
 * Storage key for persisted tickets
 */
const TICKETS_STORAGE_KEY = "ahs:tickets:data";

/**
 * Load tickets from localStorage
 * Returns centralized tickets merged with any custom/modified tickets
 */
export function loadTickets(): Ticket[] {
  // Guard against SSR - return default tickets if window is not defined
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return TICKETS;
  }
  
  try {
    const stored = localStorage.getItem(TICKETS_STORAGE_KEY);
    if (stored) {
      const savedTickets = JSON.parse(stored) as Ticket[];
      
      // Create a map of saved tickets by ticketNo for quick lookup
      const savedTicketsMap = new Map(savedTickets.map(t => [t.ticketNo, t]));
      
      // Merge: Use saved version if exists, otherwise use original
      const mergedTickets = TICKETS.map(originalTicket => {
        const savedVersion = savedTicketsMap.get(originalTicket.ticketNo);
        if (savedVersion) {
          // Remove from map so we don't add it twice
          savedTicketsMap.delete(originalTicket.ticketNo);
          return savedVersion; // Use modified version
        }
        return originalTicket; // Use original version
      });
      
      // Add any remaining custom tickets (not in original TICKETS array)
      const customTickets = Array.from(savedTicketsMap.values());
      
      // Combine: custom tickets first, then merged tickets
      const allTickets = [...customTickets, ...mergedTickets];
      
      // IMPORTANT: Deduplicate by ticketNo to prevent any duplicates
      const deduplicatedMap = new Map<string, Ticket>();
      allTickets.forEach(ticket => {
        // Keep the first occurrence (custom/modified versions come first)
        if (!deduplicatedMap.has(ticket.ticketNo)) {
          deduplicatedMap.set(ticket.ticketNo, ticket);
        }
      });
      
      return Array.from(deduplicatedMap.values());
    }
  } catch (error) {
    console.error("Error loading tickets from localStorage:", error);
  }
  return TICKETS;
}

/**
 * Save custom tickets to localStorage
 * Saves ALL tickets that have been modified from their original state
 */
export function saveCustomTickets(tickets: Ticket[]): void {
  // Guard against SSR
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return;
  }
  
  try {
    // Get original ticket numbers for comparison
    const originalTicketNos = new Set(TICKETS.map(t => t.ticketNo));
    
    // Save tickets that are either:
    // 1. Custom tickets (not in original TICKETS array)
    // 2. Original tickets that have been modified
    const ticketsToSave = tickets.filter(t => {
      // If it's a custom ticket (not in original array), save it
      if (!originalTicketNos.has(t.ticketNo)) {
        return true;
      }
      
      // If it's an original ticket, check if it has been modified
      // We check for statusChangedAt or statusChangedBy fields which indicate modifications
      if (t.statusChangedAt || t.statusChangedBy) {
        return true;
      }
      
      return false;
    });
    
    console.log(`Saving ${ticketsToSave.length} tickets to localStorage (${tickets.length} total tickets)`, ticketsToSave.map(t => t.ticketNo));
    
    localStorage.setItem(TICKETS_STORAGE_KEY, JSON.stringify(ticketsToSave));
    
    // Trigger storage event for same-tab updates
    window.dispatchEvent(new StorageEvent("storage", {
      key: TICKETS_STORAGE_KEY,
      newValue: JSON.stringify(ticketsToSave),
      storageArea: localStorage
    }));
    
    console.log(`Tickets saved successfully to ${TICKETS_STORAGE_KEY}`);
  } catch (error) {
    console.error("Error saving tickets to localStorage:", error);
  }
}

/**
 * Generate a unique ticket number
 */
export function generateTicketNumber(): string {
  const prefix = "TK";
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Create a new ticket
 * Returns the created ticket with defaults applied
 */
export function createTicket(ticketData: Partial<Ticket>): Ticket {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' }).replace(/\//g, '/');
  
  const newTicket: Ticket = {
    ticketNo: ticketData.ticketNo || generateTicketNumber(),
    ticketSource: ticketData.ticketSource || TICKET_SOURCES[0],
    warranty: ticketData.warranty || "IW",
    manufacturer: ticketData.manufacturer || "IH",
    customer: ticketData.customer || "",
    firstName: ticketData.firstName || "",
    lastName: ticketData.lastName || "",
    city: ticketData.city || "",
    location: ticketData.location || "",
    address: ticketData.address || "",
    zip: ticketData.zip || "",
    state: ticketData.state || "",
    phone: ticketData.phone || "",
    secondPhone: ticketData.secondPhone || "",
    email: ticketData.email || "",
    model: ticketData.model || "",
    serial: ticketData.serial || "",
    modelVersion: ticketData.modelVersion || "",
    productType: ticketData.productType || "",
    purchaseDate: ticketData.purchaseDate || "",
    technician: ticketData.technician || "",
    diagnosed: ticketData.diagnosed || "N",
    status: ticketData.status || "CSR-Assigned to ASC",
    schedule: ticketData.schedule || dateStr,
    internalNote: ticketData.internalNote || "",
    aging: ticketData.aging || 0,
    calls: ticketData.calls || 0,
    created: dateStr,
    redo: ticketData.redo || "N",
    partOrder: ticketData.partOrder || "Not Diagnosed",
    customerPref: ticketData.customerPref || "N",
    account: ticketData.account,
    irKit: ticketData.irKit,
    type: ticketData.type,
    branch: ticketData.branch,
    contact: ticketData.contact,
    delay: ticketData.delay,
    addressNote: ticketData.addressNote,
    fakeTicket: ticketData.fakeTicket,
    originalTicketNo: ticketData.originalTicketNo,
    callReceivedDate: ticketData.callReceivedDate,
    statusChangedAt: now.toISOString(),
    statusChangedBy: ticketData.statusChangedBy,
  };

  console.log("Created ticket object:", newTicket);
  console.log("Product Type value:", newTicket.productType);

  return newTicket;
}

/**
 * Add a new ticket to the system
 * Saves to localStorage and returns all tickets including the new one
 */
export function addTicket(ticketData: Partial<Ticket>): Ticket[] {
  const newTicket = createTicket(ticketData);
  console.log("Adding new ticket:", newTicket.ticketNo, newTicket);
  
  const currentTickets = loadTickets();
  console.log("Current tickets before adding:", currentTickets.length);
  
  const updatedTickets = [newTicket, ...currentTickets];
  console.log("Updated tickets after adding:", updatedTickets.length);
  
  saveCustomTickets(updatedTickets);
  
  return updatedTickets;
}

/**
 * Update an existing ticket
 * Returns updated tickets array
 */
export function updateTicket(ticketNo: string, updates: Partial<Ticket>): Ticket[] {
  const currentTickets = loadTickets();
  const updatedTickets = currentTickets.map(ticket => {
    if (ticket.ticketNo === ticketNo) {
      return {
        ...ticket,
        ...updates,
        statusChangedAt: new Date().toISOString(),
      };
    }
    return ticket;
  });
  
  saveCustomTickets(updatedTickets);
  
  return updatedTickets;
}

/**
 * Delete a ticket
 * Returns updated tickets array
 */
export function deleteTicket(ticketNo: string): Ticket[] {
  const currentTickets = loadTickets();
  const updatedTickets = currentTickets.filter(ticket => ticket.ticketNo !== ticketNo);
  
  saveCustomTickets(updatedTickets);
  
  return updatedTickets;
}

/**
 * Clear all custom tickets (reset to original data)
 */
export function clearCustomTickets(): void {
  // Guard against SSR
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return;
  }
  
  try {
    localStorage.removeItem(TICKETS_STORAGE_KEY);
  } catch (error) {
    console.error("Error clearing custom tickets:", error);
  }
}


/**
 * Update ticket visits
 * Saves visits array to the ticket in centralized system
 */
export function updateTicketVisits(ticketNo: string, visits: Ticket['visits']): Ticket[] {
  const currentTickets = loadTickets();
  const updatedTickets = currentTickets.map(ticket => {
    if (ticket.ticketNo === ticketNo) {
      return {
        ...ticket,
        visits: visits || [],
        statusChangedAt: new Date().toISOString(),
      };
    }
    return ticket;
  });
  
  saveCustomTickets(updatedTickets);
  console.log(`Updated visits for ticket ${ticketNo}:`, visits);
  
  return updatedTickets;
}

/**
 * Update ticket parts
 * Saves parts array to the ticket in centralized system
 */
export function updateTicketParts(ticketNo: string, parts: Ticket['parts']): Ticket[] {
  const currentTickets = loadTickets();
  const updatedTickets = currentTickets.map(ticket => {
    if (ticket.ticketNo === ticketNo) {
      return {
        ...ticket,
        parts: parts || [],
        statusChangedAt: new Date().toISOString(),
      };
    }
    return ticket;
  });
  
  saveCustomTickets(updatedTickets);
  console.log(`Updated parts for ticket ${ticketNo}:`, parts);
  
  return updatedTickets;
}

/**
 * Get ticket visits
 */
export function getTicketVisits(ticketNo: string): Ticket['visits'] {
  const ticket = getTicketByNumber(ticketNo);
  return ticket?.visits || [];
}

/**
 * Get ticket parts
 */
export function getTicketParts(ticketNo: string): Ticket['parts'] {
  const ticket = getTicketByNumber(ticketNo);
  return ticket?.parts || [];
}
