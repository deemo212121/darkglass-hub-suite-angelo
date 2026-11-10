/**
 * Page Speed (migration 0438) — the timing rules, kept free of the browser so
 * they can be tested with a fake clock. pageLoadTimings.ts feeds it the real
 * events (a page change, the page rendering, requests starting and ending).
 *
 *   shown — the page's own content is on screen. For a module page that's
 *           when its lazily-loaded component has rendered (markPageShown in
 *           m.$module.$submodule.tsx), not just the route around it.
 *   ready — shown, and no request to Supabase / the app's server has been
 *           running for QUIET_MS. The time recorded is when the last of those
 *           requests finished, not the end of the quiet wait.
 *
 * Only requests a page started itself count: one the page before left running
 * doesn't hold the next page back.
 *
 * A page left before it was ready is kept, with when it was left; a page left
 * before it even showed (a redirect, a quick click-through) is dropped, as is
 * anything measured while the tab was in the background.
 */

export const QUIET_MS = 700;
export const GIVE_UP_MS = 60_000;

export type PageTiming = {
  path: string;
  firstLoad: boolean;
  shownMs: number;
  readyMs: number | null;
  leftAfterMs: number | null;
  timedOut: boolean;
  requests: number;
};

type Nav = {
  start: number;
  firstLoad: boolean;
  path: string | null;
  needsMarker: boolean;
  renderedAt: number | null;
  markerAt: number | null;
  shownAt: number | null;
  lastEnd: number;
  requests: number;
  hidden: boolean;
};

export class PageLoadMeter {
  private nav: Nav | null = null;
  /** Requests running that this page started (see requestStarted's return). */
  private inFlight = 0;
  private page = 0;

  constructor(private readonly emit: (t: PageTiming) => void) {}

  /** Measuring a page right now? */
  get active(): boolean {
    return this.nav !== null;
  }

  /** A new page was asked for (a click, a link). The one before ends here. */
  navigate(now: number): void {
    this.leave(now);
    this.nav = this.fresh(now, false);
    this.page++;
    this.inFlight = 0;
  }

  /** The very first page of a full load: timed from the browser's own start (0). */
  firstLoad(): void {
    this.nav = this.fresh(0, true);
    this.page++;
    this.inFlight = 0;
  }

  /** The route has rendered. `needsMarker`: wait for the page's own component too. */
  rendered(now: number, path: string, needsMarker: boolean): void {
    const nav = this.nav;
    if (!nav) return;
    nav.path = path;
    // Already on screen: only the address moved (say, the page added ?tab=).
    if (nav.shownAt !== null) return;
    nav.needsMarker = needsMarker;
    nav.renderedAt = now;
    this.checkShown();
  }

  /** The module page's own component has rendered (see markPageShown). */
  marker(now: number): void {
    const nav = this.nav;
    if (!nav || nav.shownAt !== null || now < nav.start) return;
    nav.markerAt = now;
    this.checkShown();
  }

  /** Returns which page started it — pass that back to requestEnded. */
  requestStarted(): number {
    this.inFlight++;
    if (this.nav) this.nav.requests++;
    return this.page;
  }

  requestEnded(now: number, page: number): void {
    if (page !== this.page) return; // started by a page that's gone
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (this.nav && now > this.nav.lastEnd) this.nav.lastEnd = now;
  }

  /** The tab went to the background: this page's numbers wouldn't mean anything. */
  hidden(): void {
    if (this.nav) this.nav.hidden = true;
  }

  /** Called every so often while active: finishes the page once it's ready (or given up on). */
  tick(now: number): void {
    const nav = this.nav;
    if (!nav) return;
    if (nav.hidden) {
      this.nav = null;
      return;
    }
    if (now - nav.start >= GIVE_UP_MS) {
      if (nav.shownAt !== null) this.finish(nav, { readyMs: null, leftAfterMs: null, timedOut: true });
      this.nav = null;
      return;
    }
    if (nav.shownAt === null || this.inFlight > 0) return;
    const settledAt = Math.max(nav.shownAt, nav.lastEnd);
    if (now - settledAt < QUIET_MS) return;
    this.finish(nav, { readyMs: Math.round(settledAt - nav.start), leftAfterMs: null, timedOut: false });
    this.nav = null;
  }

  /** The person moved on (or closed the page): keep it if it had shown. */
  leave(now: number): void {
    const nav = this.nav;
    this.nav = null;
    if (!nav || nav.hidden || nav.shownAt === null) return;
    this.finish(nav, { readyMs: null, leftAfterMs: Math.round(now - nav.start), timedOut: false });
  }

  private fresh(start: number, firstLoad: boolean): Nav {
    return { start, firstLoad, path: null, needsMarker: false, renderedAt: null, markerAt: null, shownAt: null, lastEnd: start, requests: 0, hidden: false };
  }

  private checkShown(): void {
    const nav = this.nav;
    if (!nav || nav.renderedAt === null) return;
    if (nav.needsMarker && nav.markerAt === null) return;
    nav.shownAt = Math.max(nav.renderedAt, nav.markerAt ?? 0);
  }

  private finish(nav: Nav, end: Pick<PageTiming, "readyMs" | "leftAfterMs" | "timedOut">): void {
    if (nav.path === null || nav.shownAt === null) return;
    this.emit({
      path: nav.path,
      firstLoad: nav.firstLoad,
      shownMs: Math.round(nav.shownAt - nav.start),
      requests: nav.requests,
      ...end,
    });
  }
}

/**
 * The page a route is, for the report: module pages by module and page
 * ("/m/hr/hr-dashboard"), others by their route ("/ticket/$ticketNo") so one
 * ticket doesn't become its own row. A short `tab` in the address is kept,
 * since tabs of the same page can load very differently.
 */
export function pagePath(routeId: string | undefined, params: Record<string, unknown>, search: Record<string, unknown>, pathname: string): string {
  const p = (k: string) => String(params[k] ?? "");
  let path: string;
  if (routeId === "/m/$module/$submodule") path = `/m/${p("module")}/${p("submodule")}`;
  else if (routeId === "/m/$module/$submodule/$userId") path = `/m/${p("module")}/${p("submodule")}/$userId`;
  else if (routeId === "/m/$module") path = `/m/${p("module")}`;
  else if (routeId && routeId !== "__root__") path = routeId;
  else path = pathname || "/";
  const tab = search.tab;
  if (typeof tab === "string" && /^[\w-]{1,40}$/.test(tab)) path += `?tab=${tab}`;
  return path.slice(0, 200);
}

/** Phone, tablet or computer, from what the browser says about itself. */
export function deviceKind(userAgent: string, maxTouchPoints: number, screenWidth: number, screenHeight: number): "phone" | "tablet" | "computer" {
  const ua = userAgent || "";
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1)) return "tablet";
  if (/iPhone|iPod|Mobi|Android.*Mobile|Windows Phone/i.test(ua)) return "phone";
  if (/Android|Tablet/i.test(ua)) return "tablet";
  if (maxTouchPoints > 1 && Math.min(screenWidth, screenHeight) > 0 && Math.min(screenWidth, screenHeight) < 600) return "phone";
  return "computer";
}
