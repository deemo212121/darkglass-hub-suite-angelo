/**
 * "Approving your team" tour — managers and above, on Dashboard →
 * Attendance Monitoring (Guides → Approving Requests). Tabs are the page's
 * own tab ids; panel "missing-clockin" opens the Missing Clock In list.
 * Selectors are data-tour labels in AttendanceMonitoringPage.tsx.
 */
import type { TourDef } from "./runTour";

export const APPROVER_TOUR_TARGET = "page:attendance-monitoring";

export const APPROVER_TOUR: TourDef = {
  id: "approver-attendance",
  title: "Approving your team",
  summary: "Clocking in a technician from Missing Clock In, then approving or rejecting PTO, leave, time corrections, ticket disputes and trainee days.",
  steps: [
    {
      selector: '[data-tour="am-tabs"]',
      title: "Attendance Monitoring tabs",
      text: "Each request type has its own tab here: Corrections, Daily Attendance, Time-Off Management, Ticket Dispute, Trainee Attendance and more.",
      side: "right",
    },
    {
      selector: '[data-tour="am-alerts"]',
      title: "Today's alerts",
      text: "Missing Clock In, Missing Clock Out and Late Arrival for your team today. Click one to see who.",
      tab: "daily-attendance",
    },
    {
      selector: '[data-tour="am-missing-clockin"]',
      title: "Missing Clock In",
      text: "Everyone who hasn't clocked in today.",
      tab: "daily-attendance",
    },
    {
      selector: '[data-tour="am-alert-modal"]',
      title: "Clock someone in",
      text: "Your technicians who haven't clocked in yet have a Clock In button — it stamps their time in now. Trainees are flagged (and 'not started' if their training hasn't begun). You can add a note to each person.",
      tab: "daily-attendance",
      panel: "missing-clockin",
      side: "left",
    },
    {
      selector: '[data-tour="am-pto-leave"]',
      title: "Time-Off Management",
      text: "PTO and sick leave are under Paid Leave; unpaid time off is under Unpaid Leave.",
      tab: "pto-management",
    },
    {
      selector: '[aria-label="PTO status"]',
      title: "Pending, Approved, Rejected",
      text: "Pending is what's waiting on someone.",
      tab: "pto-management",
    },
    {
      selector: '[data-tour="am-pto-table"]',
      title: "Approving PTO and leave",
      text: "Each request shows Mgr, HR and Acct — who has acted so far. Approve or Reject at your step; a request is approved once any 2 of Manager, HR and Accounting approve. Rejecting asks for a reason, and the employee sees it.",
      tab: "pto-management",
      side: "top",
    },
    {
      selector: '[data-tour="am-pto-sample"]',
      title: "Needs your approval",
      text: "A sample request waiting on you. Your step shows ✓ Approve and ✕ Reject — sick and unpaid leave filed with an Exception Report are approved with your signature.",
      tab: "pto-management",
    },
    {
      selector: '[data-tour="sign-modal"]',
      title: "Manager / SBM Review & Approval",
      text: "✓ on that request opens this: your comments and your signature. (A sample — nothing is signed.)",
      tab: "pto-management",
      panel: "pto-manager-sign",
      side: "left",
    },
    {
      selector: '[data-tour="sign-pad"]',
      title: "Your signature",
      text: "Sign here, then approve. (The tour closes this without signing.)",
      tab: "pto-management",
      panel: "pto-manager-sign",
      side: "left",
    },
    {
      selector: '[data-tour="sign-modal"]',
      title: "HR Department Use Only",
      text: "HR signs the Exception Report here: the received date, the action status, and HR's signature. (Closed without signing.)",
      tab: "pto-management",
      panel: "pto-hr-sign",
      side: "left",
    },
    {
      selector: '[data-tour="am-corr"]',
      title: "Time Corrections",
      text: "Requests to fix a forgotten or wrong punch. New Corrections is the live list; Old Corrections is the archive.",
      tab: "corrections",
      side: "top",
    },
    {
      selector: '[data-tour="am-corr-filters"]',
      title: "Find a correction",
      text: "Search by employee, or filter by status, issue, branch or department.",
      tab: "corrections",
    },
    {
      selector: '[data-tour="am-ticket-dispute"]',
      title: "Ticket Disputes",
      text: "Failed check-ins and rescheduled tickets your technicians reported — the claimed time, their reason and any photos. Approve or Reject (with a reason).",
      tab: "ticket-dispute",
      side: "top",
    },
    {
      selector: '[data-tour="am-trainee"]',
      title: "Trainee days",
      text: "Each trainee's day waits here for their manager to review — approve it, or send it back with a reason.",
      tab: "trainee-attendance",
      side: "top",
    },
  ],
};
