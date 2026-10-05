/**
 * Tours of the ticket page, one per department (Guides module). Text lives
 * here so it can be reworded without touching the page. Selectors point at
 * `data-tour` labels / ids on src/routes/ticket.$ticketNo.tsx.
 *
 * Written so far: CSR, Triage and Parts. Claims comes next.
 */
import type { TourDef } from "./runTour";

/** Practice ticket the tours run on by default (made-up data, only in the app — see TICKET_DATA on the ticket page). */
export const PRACTICE_TICKET_NO = "TOUR-DEMO";

export const CSR_TICKET_TOUR: TourDef = {
  id: "ticket-csr",
  title: "Working a ticket (CSR)",
  summary: "Where the customer, product, schedule and notes are, how to add a visit and set the status, and what Claims still needs.",
  steps: [
    {
      selector: '[data-tour="ticket-header"]',
      title: "The ticket at a glance",
      text: "Ticket number, warranty, status, product and technician. Alerts for this ticket show above it.",
    },
    {
      selector: "#ticket-selector",
      title: "Open another ticket",
      text: "Type a ticket number and press Enter to jump to it.",
    },
    {
      selector: '[aria-label="Copy to new ticket"]',
      title: "Copy to a new ticket",
      text: "Opens New Ticket in a new tab with this ticket's details already filled in — handy for a redo or a second appliance.",
    },
    {
      selector: '[aria-label="Send ticket via Internal Messenger"]',
      title: "Share the ticket",
      text: "Sends a link to this ticket to someone in Internal Messenger.",
    },
    {
      selector: '[data-tour="ticket-tabs"]',
      title: "General and Tracking",
      text: "General has the customer, product and schedule. Tracking has the visits, attachments and parts.",
    },
    {
      selector: '[data-tour="ticket-sections"]',
      title: "Ticket sections",
      text: "This panel slides out when you hover the Sections tab on the left. Click any section to jump straight to it.",
      side: "right",
    },
    {
      selector: '[data-tour="ticket-customer"]',
      title: "Customer",
      text: "Name, address and phone. Use Edit to correct them — the change is saved in View Log.",
      tab: "general",
    },
    {
      selector: '[data-tour="ticket-product"]',
      title: "Product information",
      text: "Brand, model, serial and product type. The technician and Parts rely on this being right.",
      tab: "general",
    },
    {
      selector: '[data-tour="ticket-schedule"]',
      title: "Schedule",
      text: "The visit date and time window. Parts uses this date to get the part to the technician (Daily Pickup).",
      tab: "general",
    },
    {
      selector: '[data-tour="ticket-problem"]',
      title: "Problem description",
      text: "What the customer reported, synced from ServicePower — read it before calling the customer.",
      tab: "general",
    },
    {
      selector: '[data-tour="ticket-notes"]',
      title: "Customer notes",
      text: "The running notes from ServicePower / the warranty company. They load on their own; Refresh pulls the latest.",
      tab: "general",
    },
    {
      selector: '[data-tour="ticket-claims-readiness"]',
      title: "Claims readiness",
      text: "The checklist of what's still missing before this ticket can go to Claims, like photos. Green means it's ready.",
      tab: "general",
    },
    {
      selector: "#section-visit-log",
      title: "Visit log",
      text: "Every visit on this ticket: date, technician, what they found and what was done.",
      tab: "tracking",
      side: "top",
    },
    {
      selector: '[data-tour="ticket-add-visit"]',
      title: "Add a visit — and set the status",
      text: "Schedule the next visit here. The visit form is also where you set the ticket status — e.g. CL-Need Cancel with the reason in the Internal Note (BizOps does the actual cancel).",
      tab: "tracking",
    },
    {
      selector: "#section-attachments",
      title: "Attachments",
      text: "Photos and documents for this ticket. Claims needs the right photos here before the ticket can be paid.",
      tab: "tracking",
      side: "top",
    },
  ],
};

export const TRIAGE_TICKET_TOUR: TourDef = {
  id: "ticket-triage",
  title: "Diagnosing a ticket (Triage)",
  summary: "Read the product, problem and history, use Tech Tips, record your diagnosis, and identify the part.",
  steps: [
    {
      selector: '[data-tour="ticket-sections"]',
      title: "Ticket sections",
      text: "This panel slides out when you hover the Sections tab on the left. Click any section to jump straight to it.",
      side: "right",
    },
    {
      selector: '[data-tour="ticket-product"]',
      title: "Start with the product",
      text: "Brand, model and serial. The model is what Tech Tips and the suggested parts are matched on.",
      tab: "general",
    },
    {
      selector: '[data-tour="ticket-problem"]',
      title: "What the customer reported",
      text: "The problem description from ServicePower — the symptom you're diagnosing.",
      tab: "general",
    },
    {
      selector: '[data-tour="ticket-notes"]',
      title: "Customer notes",
      text: "Running notes from the warranty company — often extra detail about the fault or earlier attempts.",
      tab: "general",
    },
    {
      selector: "#section-tech-tips",
      title: "Tech Tips",
      text: "The repair guide for this product, symptom-matched sections first, plus test readings the technician recorded on each visit. Click to open it.",
      tab: "tracking",
      side: "top",
    },
    {
      selector: "#section-related-tickets",
      title: "Related tickets",
      text: "Other tickets with the same customer, address, model or serial — check for earlier repairs and repeat failures.",
      tab: "tracking",
      side: "top",
    },
    {
      selector: "#section-visit-log",
      title: "Visit log",
      text: "What the technician found on each visit. Your Triage Note shows on the visit it belongs to.",
      tab: "tracking",
      side: "top",
    },
    {
      selector: '[data-tour="ticket-add-visit"]',
      title: "Record your diagnosis",
      text: "The visit form (Add Visit, or Edit on a visit) has a Triage Note field — write the diagnosis and the part needed there.",
      tab: "tracking",
    },
    {
      selector: "#section-part-transaction",
      title: "Part transaction",
      text: "Triage can add and edit parts here. Each part you add goes to Parts to order.",
      tab: "tracking",
      side: "top",
    },
    {
      selector: '[data-tour="part-no"]',
      title: "Part number",
      text: "Type the part number you've identified.",
      tab: "tracking",
    },
    {
      selector: '[data-tour="part-suggestions"]',
      title: "Suggested parts",
      text: "Parts used on past completed tickets with the same model or a similar problem. Open it and click one to fill in the part.",
      tab: "tracking",
    },
    {
      selector: '[data-tour="part-dist"]',
      title: "Distributor",
      text: "Pick the distributor (e.g. Marcone) first — Lookup needs it.",
      tab: "tracking",
    },
    {
      selector: '[data-tour="part-lookup"]',
      title: "Lookup",
      text: "Looks the part up on Marcone and fills in the description, price and stock.",
      tab: "tracking",
    },
    {
      selector: '[aria-label="Part info"]',
      title: "Part info and stock",
      text: "After Lookup, the magnifying glass shows the part's details and stock at each warehouse.",
      tab: "tracking",
    },
    {
      selector: '[data-tour="part-status"]',
      title: "Part status",
      text: "Leave a new part at Need PO — that's what tells Parts to order it.",
      tab: "tracking",
    },
    {
      selector: '[data-tour="part-add"]',
      title: "Add the part",
      text: "Saves the part to the ticket. It shows in red (Need PO) until Parts submits the PO.",
      tab: "tracking",
    },
  ],
};

export const PARTS_TICKET_TOUR: TourDef = {
  id: "ticket-parts",
  title: "Parts on a ticket (Parts)",
  summary: "Read the part rows and status colours, order with Submit POs, use Truck Stock, track orders, and send drop-ship requests.",
  steps: [
    {
      selector: '[data-tour="ticket-sections"]',
      title: "Ticket sections",
      text: "This panel slides out when you hover the Sections tab on the left. Part Transaction jumps straight to the parts.",
      side: "right",
    },
    {
      selector: "#section-part-transaction",
      title: "Part transaction",
      text: "Every part on this ticket — what it is, where it's from, its PO and its status.",
      tab: "tracking",
      side: "top",
    },
    {
      selector: '[data-tour="part-row"]',
      title: "A part row",
      text: "Each part has two lines: part no., distributor, description, PO no. and dates on top; status, note, order no., ETA and tracking below. Edit any cell right in the row.",
      tab: "tracking",
    },
    {
      selector: '[data-tour="part-row-status"]',
      title: "Part status and colours",
      text: "The part number's colour follows its status: red = Need PO, yellow = PO Made, green = Part Ready, blue = Used. Moving it on: Need PO → PO Made → Part Ready → Tech Pickup.",
      tab: "tracking",
    },
    {
      selector: '[data-tour="part-update"]',
      title: "Update",
      text: "After editing cells in the rows, Update saves them. It shows how many rows have unsaved changes.",
      tab: "tracking",
    },
    {
      selector: '[data-tour="part-submit-pos"]',
      title: "Submit POs",
      text: "Orders every part that still needs a PO and turns it PO Made. Marcone and Encompass parts open a review popup first — the real order is only placed when you click Place Order there. Other distributors just get a PO number.",
      tab: "tracking",
    },
    {
      selector: '[data-tour="part-truck-stock"]',
      title: "Truck Stock",
      text: "Fill a Need PO part from in-house truck stock instead of ordering it.",
      tab: "tracking",
    },
    {
      selector: '[data-tour="part-sync-notes"]',
      title: "Sync Parts from Notes",
      text: "When Squaretrade or Allstate send the part themselves, this reads their ServicePower notes, adds the parts and fills in tracking numbers.",
      tab: "tracking",
    },
    {
      selector: '[data-tour="part-refresh"]',
      title: "Refresh an order",
      text: "On Marcone and Encompass orders: pulls the latest ETA, invoice and tracking for that order.",
      tab: "tracking",
    },
    {
      selector: '[data-tour="part-send"]',
      title: "Drop-ship request",
      text: "Emails a drop-ship request for this part from the Parts Gmail. Tick the box next to Send on several parts of the same PO to send them together.",
      tab: "tracking",
    },
    {
      selector: '[data-tour="part-view-log"]',
      title: "View Log",
      text: "The full list of this ticket's parts, including deleted ones and who changed what.",
      tab: "tracking",
    },
    {
      selector: '[data-tour="part-no"]',
      title: "Adding a part",
      text: "The top row adds a new part: part no., distributor, then Lookup for description, price and stock. New parts start at Need PO.",
      tab: "tracking",
    },
    {
      selector: "#section-visit-log",
      title: "Where the part goes next",
      text: "After PO Made, receive it on Part Receive and set Part Ready. When the visit is scheduled it becomes Tech Pickup and shows on Part Daily Pickup for that day, then Part Daily Collection.",
      tab: "tracking",
      side: "top",
    },
  ],
};

/**
 * Who sees each department's ticket tour (primary or extra role). Admin and
 * Super Admin see every tour. Claims is listed for when its tour is written.
 */
export const TICKET_TOUR_ROLES: Record<string, string[]> = {
  csr: ["CSR", "CSR_AGENT", "CSR_TEAM_LEADER", "CSR_MANAGER"],
  triage: ["TRIAGE_USER", "TRIAGE_MANAGER"],
  parts: ["PARTS", "PARTS_TEAM_LEADER", "PARTS_MANAGER", "PARTS_ORDER"],
  claims: ["CLAIMS", "CLAIMS_TEAM_LEADER", "CLAIMS_MANAGER"],
};
const SEE_ALL_TOURS = ["ADMIN", "SUPERADMIN", "SUPERSUPERADMIN"];

/** Can someone with these roles see this department's ticket tour ("csr" | "triage" | "parts" | "claims")? */
export function canSeeTicketTour(department: string, role: string | null | undefined, extraRoles?: string[] | null): boolean {
  const held = [role, ...(extraRoles ?? [])].map((r) => String(r || "").toUpperCase());
  if (held.some((r) => SEE_ALL_TOURS.includes(r))) return true;
  return held.some((r) => (TICKET_TOUR_ROLES[department] ?? []).includes(r));
}

/** Tour id -> department, for the ticket page's Tour menu. */
export const TICKET_TOUR_DEPARTMENT: Record<string, string> = {
  "ticket-csr": "csr",
  "ticket-triage": "triage",
  "ticket-parts": "parts",
};

/** Every ticket tour, in the order the Tour menu lists them. */
export const ALL_TICKET_TOURS: TourDef[] = [CSR_TICKET_TOUR, TRIAGE_TICKET_TOUR, PARTS_TICKET_TOUR];

export const TICKET_TOURS: Record<string, TourDef> = Object.fromEntries(ALL_TICKET_TOURS.map((t) => [t.id, t]));
