/**
 * Guides → one tile per department, each listing that department's tours.
 * The general guides (Getting Started, Self-Service, Approving Requests)
 * stay their own tiles for everyone.
 *
 * `roleKey` is the department in ticketTours.ts's TICKET_TOUR_ROLES that
 * decides who sees the tile (Admin / SuperAdmin see every department).
 * Logistics is the Parts team. Pre-Auth is listed under Claims and BizOps.
 */
import type { TourDef } from "./runTour";
import { CSR_TICKET_TOUR, TRIAGE_TICKET_TOUR, PARTS_TICKET_TOUR, CLAIMS_TICKET_TOUR } from "./ticketTours";
import { BIZOPS_QUEUE_TOUR, BIZOPS_PARTS_TOUR, BIZOPS_NEED_CANCEL_TOUR } from "./bizopsTours";
import { CLAIMS_PRECLAIM_TOUR, PRE_AUTH_TOUR } from "./claimsTours";

/** Where a tour runs: on a ticket (the practice ticket by default), or on a list page. */
export type GuideTourPage = "ticket" | "ticket-list" | "need-claim-list" | "pre-auth";

export interface GuideDepartment {
  key: "csr" | "triage" | "logistics" | "claims" | "bizops";
  title: string;
  intro: string;
  roleKey: string;
  tours: { def: TourDef; page: GuideTourPage }[];
}

export const GUIDE_DEPARTMENTS: GuideDepartment[] = [
  {
    key: "csr",
    title: "CSR",
    intro: "Working a ticket as a CSR — the header, customer and product details, scheduling, notes and the visit log.",
    roleKey: "csr",
    tours: [{ def: CSR_TICKET_TOUR, page: "ticket" }],
  },
  {
    key: "triage",
    title: "Triage",
    intro: "Diagnosing a ticket — the problem and notes, tech tips, related tickets, the visit log and adding the parts it needs.",
    roleKey: "triage",
    tours: [{ def: TRIAGE_TICKET_TOUR, page: "ticket" }],
  },
  {
    key: "logistics",
    title: "Logistics",
    intro: "The Parts team — ordering and tracking parts on a ticket, and checking shipments with Marcone, Encompass, NSA and GE.",
    roleKey: "parts",
    tours: [
      { def: PARTS_TICKET_TOUR, page: "ticket" },
      { def: BIZOPS_PARTS_TOUR, page: "ticket" },
    ],
  },
  {
    key: "claims",
    title: "Claims",
    intro: "Getting a ticket paid — Claims Readiness on the ticket, filing a claim ServicePower accepts the first time, and Pre-Auth.",
    roleKey: "claims",
    tours: [
      { def: CLAIMS_TICKET_TOUR, page: "ticket" },
      { def: CLAIMS_PRECLAIM_TOUR, page: "need-claim-list" },
      { def: PRE_AUTH_TOUR, page: "pre-auth" },
    ],
  },
  {
    key: "bizops",
    title: "BizOps",
    intro: "From the Operations Guidelines — the OP queues, checking parts shipments, Need Cancel, and Pre-Auth.",
    roleKey: "bizops",
    tours: [
      { def: BIZOPS_QUEUE_TOUR, page: "ticket-list" },
      { def: BIZOPS_PARTS_TOUR, page: "ticket" },
      { def: BIZOPS_NEED_CANCEL_TOUR, page: "ticket" },
      { def: PRE_AUTH_TOUR, page: "pre-auth" },
    ],
  },
];

/** The department for a Guides tile's custom key ("guide-csr" → CSR). */
export function guideDepartmentFor(custom: string | undefined | null): GuideDepartment | null {
  const key = String(custom ?? "").replace(/^guide-/, "");
  return GUIDE_DEPARTMENTS.find((d) => d.key === key) ?? null;
}
