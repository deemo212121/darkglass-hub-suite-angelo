import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase/pageLoadTimings", () => ({ PAGE_TIMINGS_TABLE: "page_load_timings", insertPageTimings: vi.fn(), isMissingTable: () => false }));

import { GIVE_UP_MS, PageLoadMeter, QUIET_MS, deviceKind, pagePath, type PageTiming } from "./pageLoadMeter";
import { isTrackedRequest } from "./pageLoadTimings";

const setup = () => {
  const out: PageTiming[] = [];
  return { m: new PageLoadMeter((t) => out.push(t)), out };
};
/** Ticks the meter from `from` to `to` every 50 ms, like the real 150 ms timer only finer. */
const run = (m: PageLoadMeter, from: number, to: number) => {
  for (let t = from; t <= to; t += 50) m.tick(t);
};

describe("PageLoadMeter", () => {
  it("times a page: shown when rendered, ready when its last request finished", () => {
    const { m, out } = setup();
    m.navigate(1000);
    m.rendered(1200, "/home", false);
    const a = m.requestStarted();
    const b = m.requestStarted();
    m.requestEnded(1900, a);
    run(m, 1200, 2500);
    expect(out).toEqual([]);
    m.requestEnded(2600, b);
    run(m, 2600, 2600 + QUIET_MS + 100);
    expect(out).toEqual([{ path: "/home", firstLoad: false, shownMs: 200, readyMs: 1600, leftAfterMs: null, timedOut: false, requests: 2 }]);
    expect(m.active).toBe(false);
  });

  it("a page with no requests is ready when shown", () => {
    const { m, out } = setup();
    m.navigate(0);
    m.rendered(300, "/profile", false);
    run(m, 300, 300 + QUIET_MS + 50);
    expect(out[0]).toMatchObject({ shownMs: 300, readyMs: 300 });
  });

  it("a module page is shown when its own component renders, not just the route", () => {
    const { m, out } = setup();
    m.navigate(0);
    m.rendered(100, "/m/hr/hr-dashboard", true);
    run(m, 100, 2000);
    expect(out).toEqual([]);
    m.marker(2400);
    run(m, 2400, 2400 + QUIET_MS + 50);
    expect(out[0]).toMatchObject({ path: "/m/hr/hr-dashboard", shownMs: 2400, readyMs: 2400 });
  });

  it("the page's marker can arrive before the route says it rendered", () => {
    const { m, out } = setup();
    m.navigate(0);
    m.marker(500);
    m.rendered(520, "/m/a/b", true);
    run(m, 520, 520 + QUIET_MS + 50);
    expect(out[0]).toMatchObject({ shownMs: 520 });
  });

  it("a full page load is timed from the browser's start", () => {
    const { m, out } = setup();
    m.firstLoad();
    m.rendered(1800, "/home", false);
    run(m, 1800, 1800 + QUIET_MS + 50);
    expect(out[0]).toMatchObject({ firstLoad: true, shownMs: 1800, readyMs: 1800 });
  });

  it("keeps a page left before it was ready, with when it was left", () => {
    const { m, out } = setup();
    m.navigate(0);
    m.rendered(400, "/m/tickets/ticket-list", false);
    m.requestStarted();
    run(m, 400, 5000);
    m.navigate(5000);
    expect(out[0]).toMatchObject({ path: "/m/tickets/ticket-list", shownMs: 400, readyMs: null, leftAfterMs: 5000, timedOut: false });
    expect(m.active).toBe(true);
  });

  it("drops a page left before it even showed (a redirect)", () => {
    const { m, out } = setup();
    m.navigate(0);
    m.navigate(50);
    m.rendered(200, "/home", false);
    run(m, 200, 200 + QUIET_MS + 50);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ path: "/home", shownMs: 150 });
  });

  it("drops a page measured while the tab was in the background", () => {
    const { m, out } = setup();
    m.navigate(0);
    m.rendered(100, "/home", false);
    m.hidden();
    run(m, 100, 2000);
    expect(out).toEqual([]);
    expect(m.active).toBe(false);
  });

  it("gives up after a minute, keeping it as timed out", () => {
    const { m, out } = setup();
    m.navigate(0);
    m.rendered(100, "/slow", false);
    m.requestStarted();
    run(m, 100, GIVE_UP_MS + 100);
    expect(out[0]).toMatchObject({ readyMs: null, leftAfterMs: null, timedOut: true });
  });

  it("a request the page before left running doesn't hold the next page back", () => {
    const { m, out } = setup();
    m.navigate(0);
    m.rendered(100, "/slow", false);
    const left = m.requestStarted();
    m.navigate(500);
    m.rendered(520, "/home", false);
    run(m, 520, 520 + QUIET_MS + 50);
    expect(out[1]).toMatchObject({ path: "/home", shownMs: 20, readyMs: 20, requests: 0 });
    m.requestEnded(2000, left);
    expect(out).toHaveLength(2);
  });

  it("an address change while loading (a page adding ?tab=) keeps the same load", () => {
    const { m, out } = setup();
    m.navigate(0);
    m.rendered(300, "/m/hr/hr-dashboard", false);
    m.rendered(350, "/m/hr/hr-dashboard?tab=hiring", false);
    run(m, 350, 350 + QUIET_MS + 50);
    expect(out[0]).toMatchObject({ path: "/m/hr/hr-dashboard?tab=hiring", shownMs: 300 });
  });

  it("a request still running holds ready back however long the quiet wait", () => {
    const { m, out } = setup();
    m.navigate(0);
    m.rendered(100, "/x", false);
    const r = m.requestStarted();
    run(m, 100, 5000);
    expect(out).toEqual([]);
    m.requestEnded(5000, r);
    run(m, 5000, 5000 + QUIET_MS + 50);
    expect(out[0]).toMatchObject({ readyMs: 5000 });
  });
});

describe("pagePath", () => {
  it("names module pages by module and page", () => {
    expect(pagePath("/m/$module/$submodule", { module: "hr", submodule: "hr-dashboard" }, {}, "/m/hr/hr-dashboard")).toBe("/m/hr/hr-dashboard");
    expect(pagePath("/m/$module", { module: "hr" }, {}, "/m/hr")).toBe("/m/hr");
  });
  it("keeps one row for every ticket and every person", () => {
    expect(pagePath("/ticket/$ticketNo", { ticketNo: "730812" }, {}, "/ticket/730812")).toBe("/ticket/$ticketNo");
    expect(pagePath("/m/$module/$submodule/$userId", { module: "csr", submodule: "x", userId: "abc" }, {}, "/m/csr/x/abc")).toBe("/m/csr/x/$userId");
  });
  it("keeps a short tab, ignores anything else in the address", () => {
    expect(pagePath("/m/$module/$submodule", { module: "hr", submodule: "hr-dashboard" }, { tab: "hiring", q: "smith" }, "")).toBe("/m/hr/hr-dashboard?tab=hiring");
    expect(pagePath("/m/$module/$submodule", { module: "hr", submodule: "hr-dashboard" }, { tab: "<script>" }, "")).toBe("/m/hr/hr-dashboard");
  });
  it("falls back to the address", () => {
    expect(pagePath(undefined, {}, {}, "/somewhere")).toBe("/somewhere");
  });
});

describe("deviceKind", () => {
  it("tells phones, tablets and computers apart", () => {
    expect(deviceKind("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", 5, 390, 844)).toBe("phone");
    expect(deviceKind("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari", 5, 412, 915)).toBe("phone");
    expect(deviceKind("Mozilla/5.0 (Linux; Android 13; SM-X200) Safari", 5, 800, 1280)).toBe("tablet");
    expect(deviceKind("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari", 5, 1024, 1366)).toBe("tablet");
    expect(deviceKind("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130", 0, 1920, 1080)).toBe("computer");
  });
});

describe("isTrackedRequest", () => {
  const origin = "https://adminhubsolution.com";
  const sb = "abc.supabase.co";
  it("counts Supabase data and the app's own server", () => {
    expect(isTrackedRequest("https://abc.supabase.co/rest/v1/tickets?select=*", origin, sb)).toBe(true);
    expect(isTrackedRequest("https://abc.supabase.co/storage/v1/object/x", origin, sb)).toBe(true);
    expect(isTrackedRequest("/api/gmail?action=status", origin, sb)).toBe(true);
    expect(isTrackedRequest("https://adminhubsolution.com/api/supabase-token", origin, sb)).toBe(true);
  });
  it("doesn't count saving the timings, realtime, Firebase or the page's own files", () => {
    expect(isTrackedRequest("https://abc.supabase.co/rest/v1/page_load_timings", origin, sb)).toBe(false);
    expect(isTrackedRequest("https://abc.supabase.co/realtime/v1/websocket", origin, sb)).toBe(false);
    expect(isTrackedRequest("https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel", origin, sb)).toBe(false);
    expect(isTrackedRequest("/assets/vendor-abc.js", origin, sb)).toBe(false);
    expect(isTrackedRequest("https://other.example.com/api/x", origin, sb)).toBe(false);
  });
});
