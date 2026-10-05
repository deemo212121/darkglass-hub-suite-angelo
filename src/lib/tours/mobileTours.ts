/**
 * Mobile app tours (MobileTechApp → Guides). `tab` here is the mobile VIEW
 * to switch to ("home", "tickets", "map", "chat", "onhold", "correction",
 * "teamapprovals", …) or "detail:<tab>" for a tab inside an open ticket;
 * `panel: "ticket"` opens one of the person's own tickets for the steps
 * inside it. Selectors are data-tour labels / classes in MobileTechApp.tsx.
 * Tours are look-only — nothing is tapped or submitted.
 */
import type { TourDef, TourStep } from "./runTour";

export type MobileTourAudience = "everyone" | "manager" | "sbm";

export interface MobileTour extends TourDef {
  category: "Getting started" | "Time & attendance" | "Tickets" | "Managers";
  audience: MobileTourAudience;
}

const step = (selector: string, title: string, text: string, tab?: string, extra: Partial<TourStep> = {}): TourStep => ({
  selector,
  title,
  text,
  ...(tab ? { tab } : {}),
  side: "top",
  ...extra,
});

export const MOBILE_TOURS: MobileTour[] = [
  // ── Getting started ────────────────────────────────────────────────
  {
    id: "m-getting-around",
    category: "Getting started",
    audience: "everyone",
    title: "Finding your way",
    summary: "The bottom bar and what each screen is for.",
    steps: [
      step('[data-tour="m-header-clock"]', "Server time", "The time and timezone your punches use — the server's clock, not your phone's.", "home", { side: "bottom" }),
      step('[data-tour="m-nav"]', "Bottom bar", "Your main screens. Tap any of them at any time.", "home"),
      step('[data-tour="m-nav-home"]', "Home", "Your time clock, today's on-site check-ins and your request tiles.", "home"),
      step('[data-tour="m-nav-tickets"]', "Tickets", "Your jobs: Today, To Do and Done. A red number means tickets missing a Work Start / Work Done time.", "home"),
      step('[data-tour="m-nav-route"]', "Route", "Today's stops on the map.", "home"),
      step('[data-tour="m-nav-chat"]', "Chat", "Messages with your team. A red number means unread messages.", "home"),
      step('[data-tour="m-nav-onhold"]', "On Hold", "Your tickets that are waiting on something.", "home"),
      step('[data-tour="m-nav-payroll"]', "Payroll", "Your payslips.", "home"),
      step('[data-tour="m-nav-guides"]', "Guides", "This tab — come back any time to replay a tour.", "home"),
    ],
  },

  // ── Time & attendance ───────────────────────────────────────────────
  {
    id: "m-time-in-out",
    category: "Time & attendance",
    audience: "everyone",
    title: "Time In and Time Out",
    summary: "Clocking in and out, meal breaks, and checking your attendance.",
    steps: [
      step('[data-tour="m-clock"]', "Your time clock", "Time In, Meal In, Meal Out and Time Out. Technicians and branch leaders enter today's code from HR when they tap Time In. The time saved is the server's time.", "home", { side: "bottom" }),
      step('[data-tour="m-tile-timecard"]', "Monitor My Attendance", "Your month at a glance — every day's check in and check out.", "home"),
      step('[data-tour="m-view-timecard"]', "Your attendance calendar", "Tap a day to see its punches.", "timecard", { side: "bottom" }),
    ],
  },
  {
    id: "m-time-correction",
    category: "Time & attendance",
    audience: "everyone",
    title: "Time Correction",
    summary: "Fixing a forgotten or wrong punch.",
    steps: [
      step('[data-tour="m-tile-correction"]', "Time Correction", "Forgot to punch, or a time is wrong? Request the fix here.", "home"),
      step('[data-tour="m-view-correction"]', "The correction form", "Pick the day, enter the correct check in and check out (the meal break too when the shift is over 6 hours), choose the issue, give the reason and sign.", "correction", { side: "bottom" }),
      step('[data-tour="m-submit"]', "Submit", "Sends it for approval.", "correction"),
    ],
  },
  {
    id: "m-ticket-time-dispute",
    category: "Time & attendance",
    audience: "everyone",
    title: "Ticket Time Dispute",
    summary: "When a check-in failed or a ticket was rescheduled.",
    steps: [
      step('[data-tour="m-tile-tickettimedispute"]', "Ticket Time Dispute", "Your check-in on a ticket failed, or the ticket was rescheduled? Report it here.", "home"),
      step('[data-tour="m-view-tickettimedispute"]', "The dispute form", "Pick the ticket, then either Time Dispute (the real start and end time) or Reschedule (the actual day). Add the reason, attach proof, and sign.", "tickettimedispute", { side: "bottom" }),
      step('[data-tour="m-submit"]', "Submit", "Sends it for approval.", "tickettimedispute"),
    ],
  },
  {
    id: "m-time-off",
    category: "Time & attendance",
    audience: "everyone",
    title: "PTO or Leave",
    summary: "Requesting PTO, sick leave or unpaid time off.",
    steps: [
      step('[data-tour="m-tile-timeoff"]', "File PTO or Leave", "PTO, sick leave or unpaid time off.", "home"),
      step('[data-tour="m-view-timeoff"]', "The leave form", "Choose the type, your first and last day, and the reason. Position and branch are filled in from your profile.", "timeoff", { side: "bottom" }),
      step('[data-tour="m-submit"]', "Submit", "Sends it for approval.", "timeoff"),
    ],
  },

  // ── Tickets ─────────────────────────────────────────────────────────
  {
    id: "m-tickets-route",
    category: "Tickets",
    audience: "everyone",
    title: "Your tickets and route",
    summary: "On-site check-in, your ticket lists, search, the route map and On Hold.",
    steps: [
      step('[data-tour="m-onsite"]', "On-Site Check-In", "For today's tickets: tap Work Start when you get there and Work Done when you finish. Location sharing and consent need to be on — Work Start may only unlock once you're at the customer's address.", "home", { side: "bottom" }),
      step(".mtech-tabs", "Today, To Do and Done", "Today is today's schedule, To Do is what's still open, Done is finished work.", "tickets", { side: "bottom" }),
      step(".mtech-searchbar", "Search", "Find any ticket by number, customer or city.", "tickets", { side: "bottom" }),
      step(".mtech-route", "Route", "Your stops for the day on the map.", "map", { side: "bottom" }),
      step(".mtech-nav-btn", "Navigate", "Opens the whole route in Google Maps.", "map"),
      step(".mtech-tabs", "On Hold", "Tickets waiting on parts or something else.", "onhold", { side: "bottom" }),
    ],
  },
  {
    id: "m-update-ticket",
    category: "Tickets",
    audience: "everyone",
    title: "Updating a ticket",
    summary: "Opens one of your tickets and walks through its tabs and the visit update.",
    steps: [
      step(".mtech-searchbar", "Open a ticket", "Tap any ticket in your list to open it. The tour opens one of yours now.", "tickets", { side: "bottom" }),
      step(".mtech-detail-head", "The ticket at a glance", "Ticket number, status, customer, schedule and product.", "detail:general", { side: "bottom", panel: "ticket" }),
      step(".mtech-detail-tabs", "Ticket tabs", "General, Service Tracking, Tips, Parts and Billing.", "detail:general", { side: "bottom", panel: "ticket" }),
      step(".mtech-visit-list", "Service Tracking", "Every visit, newest first. Tap Edit on the latest one to record the repair status and what you did — or the reason it couldn't be completed. Saving can mark the ticket Ready to Complete.", "detail:tracking", { panel: "ticket" }),
      step('[data-tour="m-detail-tips"]', "Tips", "The repair guide for this product, and the test readings you record on each visit.", "detail:tips", { panel: "ticket" }),
      step('[data-tour="m-detail-parts"]', "Parts", "The parts on this ticket and where each one is.", "detail:parts", { panel: "ticket" }),
      step('[data-tour="m-detail-billing"]', "Billing", "Billing details for this ticket.", "detail:billing", { panel: "ticket" }),
      step('[data-tour="m-nav-tickets"]', "Back to your list", "Tickets takes you back to your list.", "tickets"),
    ],
  },
  {
    id: "m-chat",
    category: "Tickets",
    audience: "everyone",
    title: "Chat",
    summary: "Messaging your team.",
    steps: [
      step('[data-tour="m-nav-chat"]', "Chat", "Tap Chat any time. The red number is how many messages you haven't read.", "home"),
      step(".mtech-chat-inbox", "Your conversations", "Tap a conversation to open it and reply.", "chat", { side: "bottom" }),
    ],
  },

  // ── Managers ────────────────────────────────────────────────────────
  {
    id: "m-branch-manager",
    category: "Managers",
    audience: "manager",
    title: "Branch Manager: your team",
    summary: "Approving your team's requests, clocking technicians in, and today's attendance.",
    steps: [
      step('[data-tour="m-tile-teamapprovals"]', "Team Approvals", "Everything waiting for you to approve.", "home"),
      step(".mtech-approvals-tabs", "What's waiting", "Trainee days, Time Corrections, PTO and Ticket Disputes — the number is how many are waiting. Open one to Approve, or Reject with a reason (the employee sees the reason).", "teamapprovals", { side: "bottom" }),
      step('[data-tour="m-tile-clockinteam"]', "Clock In Team", "Your technicians today.", "home"),
      step('[data-tour="m-view-clockinteam"]', "Clocking someone in", "Anyone not clocked in yet has a Clock In button. Trainees are tagged, and their punch goes to their trainee timecard for review.", "clockinteam", { side: "bottom" }),
      step('[data-tour="m-tile-teamattendance"]', "Team Attendance", "Your team's day.", "home"),
      step('[data-tour="m-view-teamattendance"]', "Today's attendance", "Each person's time in and out today. Not clocked in yet and missing clock-outs are flagged.", "teamattendance", { side: "bottom" }),
      step('[data-tour="m-tile-branchreport"]', "Daily Report", "Your branch's notes and urgency for the day.", "home"),
    ],
  },
  {
    id: "m-senior-branch-manager",
    category: "Managers",
    audience: "sbm",
    title: "Senior Branch Manager: your branches",
    summary: "The same team screens, covering every branch you own.",
    steps: [
      step('[data-tour="m-tile-teamapprovals"]', "Team Approvals", "Requests from the branches you own, including your Branch Managers' own requests.", "home"),
      step(".mtech-approvals-tabs", "What's waiting", "Trainee days, Time Corrections, PTO and Ticket Disputes. Approve, or Reject with a reason.", "teamapprovals", { side: "bottom" }),
      step('[data-tour="m-tile-clockinteam"]', "Clock In Team", "Technicians across your branches.", "home"),
      step('[data-tour="m-view-clockinteam"]', "Clocking someone in", "Anyone not clocked in yet has a Clock In button.", "clockinteam", { side: "bottom" }),
      step('[data-tour="m-tile-teamattendance"]', "Team Attendance", "Who's in and who's missing a clock-in or clock-out today.", "home"),
      step('[data-tour="m-tile-branchreport"]', "Daily Report", "Notes and urgency for your branches.", "home"),
    ],
  },
];

export const MOBILE_TOUR_CATEGORIES: MobileTour["category"][] = ["Getting started", "Time & attendance", "Tickets", "Managers"];
