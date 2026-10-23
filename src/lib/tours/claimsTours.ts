/**
 * Claims tours — Guides → Claims (Pre-Auth also under BizOps). Look-only like every tour: they
 * highlight and explain; nothing is saved, submitted or sent to ServicePower.
 *
 *  1. Filing a claim without errors — Need Claim List, then the Pre-Claim of
 *     the first ticket in the list (opened for the tour, closed after).
 *  2. Pre-Auth — Claims → Pre-Auth, then the form of the first ticket in the
 *     list (opened for the tour, closed after).
 */
import type { TourDef } from "./runTour";

/** Where Guides queues each tour (the page picks it up once it has loaded). */
export const NEED_CLAIM_LIST_TOUR_TARGET = "need-claim-list";
export const PRE_AUTH_TOUR_TARGET = "pre-auth";

export const CLAIMS_PRECLAIM_TOUR: TourDef = {
  id: "claims-preclaim",
  title: "Filing a claim without errors",
  summary: "Need Claim List → Pre-Claim: what ServicePower needs per company (Job Code, Repair Category, Defect Code, invoice #s) and how the check before sending works.",
  steps: [
    {
      selector: '[data-tour="ncl-filters"]',
      title: "Find the tickets to claim",
      text: "Pick the date range and which tickets to show — Ready to Complete, Cancelled, Claimed. The list only shows tickets in claim statuses.",
    },
    {
      selector: '[data-tour="ncl-key"]',
      title: "Colour key and company chips",
      text: "The dots mark aging tickets, the red <b>Y</b> is a REDO, and each Claim To company has its own colour. <b>Click a company chip</b> to show only that company's tickets — handy for working GE, Square Trade or Assurant one at a time.",
    },
    {
      selector: '[data-tour="ncl-table"]',
      title: "Open the Pre-Claim",
      text: "Each row has <b>›Pre-Claim</b> — the claim form for that ticket. The tour opens the first one for you now (nothing is saved).",
      side: "top",
    },
    {
      selector: '[data-tour="pc-glance"]',
      panel: "preclaim",
      title: "At a glance",
      text: "Miles to the customer, the warranty company (with a ServicePower HUB link), <b>REDO</b> in red, and the <b>Pre-Auth</b> in red when there is one — read from ServicePower's Call Auth: status and the <b>authorized</b> amount to claim.",
      side: "bottom",
    },
    {
      selector: '[data-tour="pc-claim"]',
      panel: "preclaim",
      title: "Claim & product details",
      text: "Check the account, model and serial against the rating-plate photo. Model and serial can be corrected here — they're saved onto the ticket.",
    },
    {
      selector: '[data-tour="pc-classification"]',
      panel: "preclaim",
      title: "Job Code, Repair Category, Defect Code",
      text:
        "What ServicePower rejects most often — the right field changes with the company:<br>" +
        "<b>GE</b> — Job Code (MA00 / MG00 / SS00 / SG00) is required.<br>" +
        "<b>Square Trade</b> — Repair / Job Code 1 (REP, BER, CNR, NPF, PNA); Repair Category <i>Minor on-site service</i> and Defect <b>MECH</b> fill in for you.<br>" +
        "<b>Assurant</b> — Job Code / Tier Code (MA00…T403, with the tier amount beside each).<br>" +
        "<b>Electrolux / Frigidaire</b> — the Defect Code takes the Job Code's spot.<br>" +
        "Repair Category is ServicePower's own list — pick from it, don't type.",
    },
    {
      selector: '[data-tour="pc-parts"]',
      panel: "preclaim",
      title: "Parts — invoice # on every part",
      text: "Every part being claimed needs its <b>Invoice #</b> (GE sends a claim back with \"Blank Parts Invoice Number\" otherwise). The claim's Job Code fills each part's Job Code.",
      side: "top",
    },
    {
      selector: '[data-tour="pc-amount"]',
      panel: "preclaim",
      title: "Claim amount",
      text: "Labor, part fee, mileage and the rest add up to the <b>Claim Total</b>. With an approved Pre-Auth, claim the authorized amount.",
      side: "top",
    },
    {
      selector: '[data-tour="pc-actions"]',
      panel: "preclaim",
      title: "Save, then submit",
      text:
        "<b>Submit Pre-Claim</b> only saves the form.<br>" +
        "<b>Submit to ServicePower</b> first opens a check: anything in <b>red</b> must be filled in (the button stays locked), anything in <b>amber</b> would go blank — fix it or choose Submit anyway. " +
        "After sending, ServicePower's answer shows here (e.g. \"Servicer to Correct\" with what to fix); resubmitting updates the same claim. <i>The tour doesn't click anything.</i>",
      side: "bottom",
    },
  ],
};

export const PRE_AUTH_TOUR: TourDef = {
  id: "claims-pre-auth",
  title: "Pre-Auth (Call Auth) — complete guide",
  summary: "Claims → Pre-Auth from start to finish: the queue, every field of ServicePower's Call Auth form, parts with Part NLA (vs back order), amounts, saving, and why sending is locked.",
  steps: [
    {
      selector: '[data-tour="pa-send-badge"]',
      title: "What a Pre-Auth is",
      text:
        "A Pre-Auth (ServicePower calls it <b>Call Auth</b> / Request for Authorization) asks the warranty company to approve <b>more than the normal rate</b> — extra labor, a 2-man job, expensive parts — <b>before</b> the work is done. The approved amount is what you claim later.<br>" +
        "Sending from here stays <b>off</b> until a SuperAdmin turns it on (Admin → Company Settings) — until then, fill it in here and file it on ServicePower's Call Auth screen.",
    },
    {
      selector: '[data-tour="pa-cards"]',
      title: "Pending and Completed",
      text: "<b>Pending</b> = not sent yet (Not started, Draft, Ready). <b>Completed</b> = sent. Click a card to show only those; the From / To dates drive both.",
    },
    {
      selector: '[data-tour="pa-open"]',
      title: "Any ticket",
      text: "The list shows tickets in <b>PT-Need PreAuthorization</b>. For any other ticket, type its number here and Open.",
    },
    {
      selector: '[data-tour="pa-table"]',
      title: "The queue",
      text: "Every column has a filter (company, technician, Managed by, date…). <b>Start Pre-Auth</b> / <b>Open</b> opens the form — the tour opens the first one now (nothing is saved).",
      side: "top",
    },
    {
      selector: '[data-tour="pa-details"]',
      panel: "form",
      title: "1. Check the request details",
      text: "Customer, address, brand and dates come from the ticket. <b>Model</b> and <b>Serial</b> can be corrected here (read them off the rating-plate photo) — they're saved onto the ticket. Managed by is you.",
      side: "right",
    },
    {
      selector: '[data-tour="pa-desc"]',
      panel: "form",
      title: "2. Repair description and why",
      text:
        "<b>Repair Description *</b> — what the job is and what you're asking for, e.g. <i>\"Unit is a wall oven. Requesting additional labor.\"</i><br>" +
        "<b>Why a higher rate</b> — the reason, e.g. <i>\"Replaced cooling fan; built-in unit needs two techs to pull out.\"</i> Be specific — this is what the warranty company reads to approve it.",
    },
    {
      selector: '[data-tour="pa-jobcode"]',
      panel: "form",
      title: "3. Job Code",
      text: "Pick from the company's list (GE: MA00 – Major Appliance Standard Repair…, Assurant: the tier codes with their amounts, Square Trade: REP / BER…). The note under the box shows what the code means.",
    },
    {
      selector: '[data-tour="pa-time"]',
      panel: "form",
      title: "4. Estimated time on the job",
      text: "Hours and minutes the repair will take, e.g. <b>1 hrs 30 min</b>. Required.",
    },
    {
      selector: '[data-tour="pa-questions"]',
      panel: "form",
      title: "5. The yes / no questions",
      text:
        "Answer every one with a <b>*</b>:<br>" +
        "<b>Product repaired?</b> — Yes if it's fixed / will be fixed on this visit.<br>" +
        "<b>Parts in warranty?</b> / <b>Labor in warranty?</b> — whether the manufacturer's warranty still covers them.<br>" +
        "<b>OEM authorized?</b> — whether you're an authorized servicer for that brand.<br>" +
        "<b>Additional man?</b> — Yes for a 2-man job (stacked units, built-ins) — that's what earns the higher tier.<br>" +
        "<b>New Brand</b> is filled from the ticket; Days owned is worked out from the purchase date.",
    },
    {
      selector: '[data-tour="pa-labor"]',
      panel: "form",
      title: "6. Labor, miles and travel",
      text: "<b>Labor</b> — the labor amount you're requesting. <b># of miles × rate per mile</b> for long trips, and <b>Travel</b> if any.",
    },
    {
      selector: '[data-tour="pa-parts"]',
      panel: "form",
      title: "7. Parts — and Part NLA",
      text:
        "The ticket's parts are filled in: Qty, Part #, Description, Price (ServicePower adds its own markup). Add or remove lines as needed.<br>" +
        "<b>Part NLA</b> = <b>No Longer Available</b> — the part is discontinued and will <b>never</b> come. Tick it on that line; it's sent with the Pre-Auth so the warranty company can approve a substitute, a replacement or a buyout.<br>" +
        "<b>Not the same as a back order</b> — a back-ordered part has <b>no stock right now</b> but will ship later (the part shows <i>Back Order</i>, the ticket waits in <i>OP-Waiting for Part</i>). Don't tick NLA for a back order.",
      side: "top",
    },
    {
      selector: '[data-tour="pa-amounts"]',
      panel: "form",
      title: "8. The total",
      text: "Labor + parts + mileage + travel = the <b>TOTAL</b> you're asking ServicePower to authorize. Once approved, the Pre-Claim header shows the <b>authorized</b> amount — claim that.",
      side: "top",
    },
    {
      selector: '[data-tour="pa-actions"]',
      panel: "form",
      title: "9. Save it",
      text:
        "<b>Save Draft</b> anytime. <b>Save as Ready</b> only works when every * field is filled — the missing ones are listed above the buttons. " +
        "<b>Preview what would be sent</b> shows exactly what ServicePower would get (including Part NLA). " +
        "<b>Submit</b> stays locked while sending is off. <i>The tour doesn't click anything.</i>",
      side: "top",
    },
  ],
};

export const CLAIMS_TOURS: { def: TourDef; target: string; page: { module: string; submodule: string }; where: string }[] = [
  { def: CLAIMS_PRECLAIM_TOUR, target: NEED_CLAIM_LIST_TOUR_TARGET, page: { module: "claims", submodule: "need-claim-list" }, where: "runs on Need Claim List" },
  { def: PRE_AUTH_TOUR, target: PRE_AUTH_TOUR_TARGET, page: { module: "claims", submodule: "pre-auth" }, where: "runs on Claims → Pre-Auth" },
];
