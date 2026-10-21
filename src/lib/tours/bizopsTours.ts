/**
 * BizOps tours — from "OPERATIONS GUIDELINES and Ticket PROCESSES".
 * Look-only like every tour: they highlight and explain, nothing is
 * changed, submitted or sent (the ticket ones run on the practice ticket by
 * default).
 *
 *  1. Working the OP queues — Ticket List (filters + daily review).
 *  2. Checking parts shipments — ticket page (Part Transaction, Refresh for
 *     Marcone / Encompass, portal steps for NSA and GE, then the update).
 *  3. Need Cancel — ticket page (reasons, documenting, setting the status).
 *
 * The NSA / GE portals are outside the app, so those steps show the portal's
 * own steps, the number to search (with Copy) and an Open link.
 */
import type { TourDef } from "./runTour";

/** Where to start the Ticket List tour (Guides queues it here). */
export const TICKET_LIST_TOUR_TARGET = "ticket-list";

export const BIZOPS_QUEUE_TOUR: TourDef = {
  id: "bizops-op-queues",
  title: "Working the OP queues (BizOps)",
  summary: "Ticket List: pick an OP queue, narrow it to your region, and review yesterday's tickets so nothing ages.",
  steps: [
    {
      selector: '[aria-label="Repair status filter"]',
      title: "Pick an OP queue",
      text:
        "All Repair Status → choose the queue you're working:<br>" +
        "<b>OP-Ready for Service</b> — scheduled yesterday or earlier, no technician update yet. Follow up with the technician for the visit status.<br>" +
        "<b>OP-Reschedule Follow up</b> — needs a return visit after diagnosis. Make sure the technician requested and ordered every part.<br>" +
        "<b>OP-UPDATE HOLD</b> — on hold: missing documents, no technician update, photos or info needed, or waiting on clarification.<br>" +
        "<b>OP-Waiting for Part</b> — parts ordered. Track the ETA (see the <i>Checking parts shipments</i> tour).",
    },
    {
      selector: '[aria-label="Location filter"]',
      title: "Your region",
      text: "Ticket Review is done per region — Eastern, Western and Central. Pick your region's branches here, one at a time.",
    },
    {
      selector: '[aria-label="Status group filter"]',
      title: "Open tickets only",
      text: "Open / Pending hides tickets that are already completed, claimed or cancelled, so only the work that's left shows.",
    },
    {
      selector: '[aria-label="Search tickets"]',
      title: "Find one ticket",
      text: "Search by ticket number, customer name, address or zip when a technician or Branch Manager asks about a specific one.",
    },
    {
      selector: '[data-tour="ticket-list-table"]',
      title: "Daily ticket review",
      text:
        "Every morning, go through yesterday's tickets for each region (OP-Ready for Service is exactly those). Each one should be updated and moved to the right status.<br>" +
        "Look for: missing technician updates, delayed progress, wrong status. Check the notes, diagnosis, service performed, parts ordered and next steps are all there.<br>" +
        "Follow up with the technician or Branch Manager when they aren't, and escalate tickets that sit too long — the goal is no aging tickets and on-time SLAs.",
      side: "top",
    },
    {
      selector: '[data-tour="ticket-list-table"]',
      title: "Open a ticket",
      text: "Click a ticket number to open it. On the ticket, the <i>Checking parts shipments</i> and <i>Need Cancel</i> tours show the next steps.",
      side: "top",
    },
  ],
};

export const BIZOPS_PARTS_TOUR: TourDef = {
  id: "bizops-parts-shipments",
  title: "Checking parts shipments (BizOps)",
  summary: "For OP-Waiting for Part: find the PO on the ticket, check the shipment (Refresh for Marcone / Encompass, the portal for NSA / GE) and update the ticket.",
  steps: [
    {
      selector: '[data-tour="ticket-sections"]',
      title: "Sections",
      text: "Hover the Sections tab on the left and choose Service Tracking — or Part Transaction to jump straight to the parts.",
      side: "right",
    },
    {
      selector: "#section-part-transaction",
      title: "Part Transaction",
      text: "Every part on this ticket with its distributor, PO number, status, ETA and tracking. Check the Distributor column — it tells you where to look for the shipment.",
      tab: "tracking",
      side: "top",
    },
    {
      selector: '[data-tour="part-po"]',
      title: "The PO number",
      text: "The PO number is what Marcone, Encompass and GE search by. NSA searches by the ticket number instead.",
      tab: "tracking",
    },
    {
      selector: '[data-tour="part-refresh"]',
      title: "Marcone or Encompass — Refresh",
      text: "No need to open their portal: Refresh pulls the latest order status, ETA, tracking and invoice into this row.",
      tab: "tracking",
    },
    {
      selector: "#ticket-selector",
      title: "NSA — check on their website",
      text:
        "NSA isn't connected to the app, so check it on their site:<br>" +
        "1. Log in → <b>Work Orders</b> → <b>Repair Inquiry</b>.<br>" +
        "2. Paste the ticket number in <b>Tag/Dispatch</b> → Enter.<br>" +
        "3. Lower part of the page → <b>Parts</b> tab → click the part number.<br>" +
        "4. Note the shipment status, carrier and tracking, ETA, quantity shipped and any shortages.",
      copy: { label: "Ticket # to search", selector: "#ticket-selector" },
      links: [{ label: "Open NSA website ↗", href: "https://nationalservicealliance.com/sf/sfDashboard.cgi" }],
    },
    {
      selector: '[data-tour="part-po"]',
      title: "GE — check on the GE Parts Portal",
      text:
        "GE isn't connected to the app either:<br>" +
        "1. Log in → <b>Sales Agreement</b> drop-down → pick the agreement.<br>" +
        "2. <b>Tools</b> → <b>Manage Orders</b>.<br>" +
        "3. Paste the PO in <b>Order Reference #</b> → <b>Find Orders</b>.<br>" +
        "4. Open the order number → note the order and shipment status, carrier, tracking, ETA and any backorder.",
      tab: "tracking",
      copy: { label: "PO # to search", selector: '[data-tour="part-po"] input' },
    },
    {
      selector: '[data-tour="part-row"]',
      title: "Write down what you found",
      text: "Put the latest status, ETA and tracking on the part row, so everyone sees the same thing.",
      tab: "tracking",
    },
    {
      selector: '[data-tour="ticket-add-visit"]',
      title: "Then update the ticket",
      text:
        "<b>All parts delivered</b> → have CSR call the customer to schedule the return visit and set the status to <b>CSR-Needs Scheduling</b>.<br>" +
        "<b>Still pending or backordered</b> → note the new ETA and keep watching the order until every part arrives.",
      tab: "tracking",
    },
  ],
};

export const BIZOPS_NEED_CANCEL_TOUR: TourDef = {
  id: "bizops-need-cancel",
  title: "Need Cancel (BizOps)",
  summary: "When a ticket can be endorsed for cancellation, what to document first, and where the status is set.",
  steps: [
    {
      selector: '[data-tour="ticket-header"]',
      title: "When a ticket can be Need Cancel",
      text:
        "Only for one of these reasons:<br>" +
        "• Customer unreachable after several attempts &nbsp;• Customer refused or canceled &nbsp;• Canceled by the warranty provider<br>" +
        "• Duplicate ticket or claim &nbsp;• Address out of coverage &nbsp;• Unit not covered by the warranty<br>" +
        "• Unit is working now, no service needed &nbsp;• Customer asked to close the ticket<br>" +
        "• Customer unavailable past the scheduling window — told to get a new ticket when ready",
    },
    {
      selector: '[data-tour="ticket-notes"]',
      title: "Check the history first",
      text: "Read the notes: every contact attempt (date, time, how) and the reason should already be there.",
      tab: "general",
    },
    {
      selector: "#section-visit-log",
      title: "Document it",
      text: "Before endorsing it, make sure every contact attempt and the cancellation reason are written on the ticket.",
      tab: "tracking",
      side: "top",
    },
    {
      selector: '[data-tour="ticket-add-visit"]',
      title: "Set CL-Need Cancel",
      text: "The visit form is where the status is set: <b>CL-Need Cancel</b>, with the reason in the Internal Note. If service may be needed later, tell the customer to ask their warranty provider for a new ticket.",
      tab: "tracking",
    },
  ],
};

export const BIZOPS_TICKET_TOURS: TourDef[] = [BIZOPS_PARTS_TOUR, BIZOPS_NEED_CANCEL_TOUR];
