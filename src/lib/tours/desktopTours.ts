/**
 * Desktop "Getting started" tour — the header and the home dashboard
 * (Guides → Getting Started, runs on /home). Selectors are data-tour labels
 * / aria-labels in Header.tsx, TimeClockMenu.tsx and routes/home.tsx.
 */
import type { TourDef } from "./runTour";

/** Where queueTour() hands this tour to the home page. */
export const GETTING_STARTED_TARGET = "page:home";

export const DESKTOP_GETTING_STARTED_TOUR: TourDef = {
  id: "desktop-getting-started",
  title: "Finding your way",
  summary: "The header — modules, clock, notifications, messages, your account — and the home dashboard.",
  steps: [
    {
      selector: '[data-tour="hdr-home"]',
      title: "Home",
      text: "Click the logo any time to come back to this page.",
    },
    {
      selector: '[data-tour="hdr-modules"]',
      title: "Modules",
      text: "Click Modules to see every module you can open; hover one to see its pages and jump straight to one.",
    },
    {
      selector: '[data-tour="hdr-clock"]',
      title: "Company time",
      text: "The current time in your timezone, from the server — the same clock your punches use.",
    },
    {
      selector: '[data-tour="time-clock"]',
      title: "Your time clock",
      text: "Time In, Meal In / Meal Out and Time Out. Technicians and branch leaders enter today's code from HR to Time In.",
    },
    {
      selector: '[aria-label="Toggle theme"]',
      title: "Light or dark",
      text: "Switch between light and dark mode.",
    },
    {
      selector: '[aria-label="Announcements"]',
      title: "Announcements",
      text: "Company announcements.",
    },
    {
      selector: '[aria-label^="Notifications"]',
      title: "Notifications",
      text: "Approvals, requests and updates meant for you. The number shows how many you haven't read.",
    },
    {
      selector: '[aria-label^="Messages"]',
      title: "Messages",
      text: "Internal messages with your team.",
    },
    {
      selector: '[aria-label="Account menu"]',
      title: "Your account",
      text: "Your profile, timecard, settings, privacy, IT tickets, switching to Mobile View, and signing out.",
      side: "left",
    },
    {
      selector: '[data-tour="home-modules"]',
      title: "Your modules",
      text: "Every module you have access to, with the pages inside it. Click a module to open it.",
      side: "top",
    },
    {
      selector: '[data-tour="home-module-guides"]',
      title: "Guides",
      text: "Come back here any time to replay a tour — Getting Started, Ticket Guides and Self-Service.",
      side: "top",
    },
  ],
};
