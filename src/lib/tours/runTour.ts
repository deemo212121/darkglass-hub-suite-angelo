/**
 * Guided tours (Guides module). A thin wrapper around driver.js: dims the
 * page, highlights one element at a time and shows a Next / Back bubble.
 *
 * Steps point at `[data-tour="…"]` labels (or ids) on the page, not CSS
 * classes, so restyling a page doesn't break its tour. A step can name the
 * page tab it lives on (e.g. the ticket's General / Tracking tab); the
 * runner switches to it first. Steps whose element isn't on the page (a
 * section this ticket doesn't have, or one this person can't see) are
 * skipped, never shown pointing at nothing.
 */
// driver.js and its CSS load only when a tour starts (keeps them out of the
// page bundle and away from server rendering).
import type { Driver } from "driver.js";

export interface TourStep {
  /** CSS selector — prefer `[data-tour="name"]`. */
  selector: string;
  title: string;
  text: string;
  /** Page tab the element lives on; the runner switches to it before highlighting. */
  tab?: string;
  /**
   * A form / popup the element is inside (e.g. "pto" for the PTO request
   * form). The runner opens it before the step and closes it when the tour
   * moves past it or is closed — so people can see inside without leaving
   * the tour. Nothing in it is submitted.
   */
  panel?: string;
  side?: "top" | "bottom" | "left" | "right";
}

export interface TourDef {
  id: string;
  title: string;
  /** One line shown on the Guides page. */
  summary: string;
  steps: TourStep[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait (briefly) for an element — a tab switch re-renders the page first. */
async function waitFor(selector: string, timeoutMs = 1500): Promise<Element | null> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const el = document.querySelector(selector);
    // Present but hidden (display:none, e.g. a header item on a narrow screen) counts as missing.
    if (el && el.getClientRects().length > 0) return el;
    if (Date.now() > end) return null;
    await sleep(80);
  }
}

let active: Driver | null = null;

/** Fired on window when a tour starts or ends — e.g. the ticket's Sections sidebar stays open while one runs. */
export const TOUR_CHANGE_EVENT = "ahs-tour-change";
const announce = (running: boolean) => {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(TOUR_CHANGE_EVENT, { detail: { running } }));
};

export function isTourRunning(): boolean {
  return !!active;
}

/**
 * Run a tour. `setTab` switches the page's tab for steps that have one.
 * Resolves when the tour is closed or finished.
 */
export function runTour(
  def: TourDef,
  opts: { setTab?: (tab: string) => void; openPanel?: (panel: string) => void; closePanel?: (panel: string) => void } = {}
): Promise<void> {
  active?.destroy();
  return loadDriver().then(({ driver }) => new Promise<void>((resolve) => {
    const steps = def.steps;
    let currentTab: string | undefined;
    let currentPanel: string | null = null;
    const setPanel = async (want: string | null) => {
      if (want === currentPanel) return;
      if (currentPanel) opts.closePanel?.(currentPanel);
      if (want) opts.openPanel?.(want);
      currentPanel = want;
      await sleep(180); // let the form open / close before looking for the element
    };

    // Find the next step (from `from`, moving by `dir`) whose element is on the page.
    const findStep = async (from: number, dir: 1 | -1): Promise<number> => {
      for (let i = from; i >= 0 && i < steps.length; i += dir) {
        const s = steps[i];
        if (s.tab && s.tab !== currentTab) {
          opts.setTab?.(s.tab);
          currentTab = s.tab;
        }
        await setPanel(s.panel ?? null);
        if (await waitFor(s.selector, s.tab || s.panel ? 1500 : 300)) return i;
      }
      return -1;
    };

    const d = driver({
      showProgress: true,
      progressText: "{{current}} of {{total}}",
      nextBtnText: "Next →",
      prevBtnText: "← Back",
      doneBtnText: "Done",
      popoverClass: "ahs-tour",
      overlayOpacity: 0.65,
      stagePadding: 6,
      stageRadius: 10,
      smoothScroll: true,
      allowClose: true,
      // Look-only: the highlighted element can't be clicked during a tour. Clicking it
      // used to open things (e.g. the payslip) underneath the tour's overlay, where
      // their ✕ / Close couldn't be reached. Forms the tour shows are opened by the tour.
      disableActiveInteraction: true,
      steps: steps.map((s) => ({
        element: () => document.querySelector(s.selector) as Element,
        popover: { title: s.title, description: s.text, side: s.side ?? "bottom", align: "start" },
      })),
      onNextClick: async (_el, _step, { driver: drv }) => {
        const next = await findStep((drv.getActiveIndex() ?? 0) + 1, 1);
        if (next < 0) drv.destroy();
        else drv.moveTo(next);
      },
      onPrevClick: async (_el, _step, { driver: drv }) => {
        const prev = await findStep((drv.getActiveIndex() ?? 0) - 1, -1);
        if (prev >= 0) drv.moveTo(prev);
      },
      onDestroyed: () => {
        if (currentPanel) opts.closePanel?.(currentPanel);
        currentPanel = null;
        active = null;
        announce(false);
        resolve();
      },
    });
    active = d;
    announce(true);

    void (async () => {
      // Give panels that open for the tour (e.g. the ticket Sections sidebar) time to slide in.
      await sleep(300);
      const first = await findStep(0, 1);
      if (first < 0) {
        active = null;
        announce(false);
        resolve();
        return;
      }
      d.drive(first);
    })();
  }));
}

let driverModule: Promise<typeof import("driver.js")> | null = null;
function loadDriver() {
  driverModule ??= Promise.all([import("driver.js"), import("driver.js/dist/driver.css"), import("./tour.css")]).then(([m]) => m);
  return driverModule;
}

// ---- Handing a tour to the next page (Guides → ticket) ----------------------

const PENDING_KEY = "ahs:pending-tour";

/** Ask the next page that opens to start this tour (e.g. the ticket page). */
export function queueTour(tourId: string, where: string): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ tourId, where, at: Date.now() }));
  } catch {
    /* storage blocked — the tour just won't auto-start */
  }
}

/** If a tour was queued for `where` in the last minute, take it (once). */
export function takeQueuedTour(where: string): string | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { tourId: string; where: string; at: number };
    if (p.where !== where || Date.now() - p.at > 60_000) return null;
    sessionStorage.removeItem(PENDING_KEY);
    return p.tourId;
  } catch {
    return null;
  }
}
