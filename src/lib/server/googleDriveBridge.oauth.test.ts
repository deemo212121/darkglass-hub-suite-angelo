/**
 * Custom Forms' Google Drive connect: only a state the server signed can save a
 * connection. fetch is replaced for the whole file, and anything it doesn't
 * recognize throws, so these can't reach Google or the database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabaseTokenBridge", async (importActual) => ({
  ...(await importActual<typeof import("./supabaseTokenBridge")>()),
  // The test's idToken is simply the caller's firebase uid.
  verifyFirebaseToken: vi.fn(async (idToken: string) => ({ sub: idToken })),
}));
vi.mock("./customFormsBridge", () => ({ fetchSubmissionForNotify: vi.fn() }));

import { handleGoogleDriveRequest } from "./googleDriveBridge";

const COMPANY = "c0000000-0000-0000-0000-000000000001";
const OTHER_COMPANY = "c0000000-0000-0000-0000-000000000002";
const people = [
  { firebase: "admin", id: "p-admin", company_id: COMPANY, role: "ADMIN", display_name: "Ada Admin", username: null, email: "a@x.com" },
  { firebase: "hr", id: "p-hr", company_id: COMPANY, role: "HR", display_name: "Hana HR", username: null, email: "h@x.com" },
];
const ENV = {
  VITE_SUPABASE_URL: "https://db.test",
  SUPABASE_SERVICE_KEY: "service-key",
  VITE_FIREBASE_PROJECT_ID: "proj",
  GOOGLE_DRIVE_CLIENT_ID: "client-id",
  GOOGLE_DRIVE_CLIENT_SECRET: "client-secret",
};

let saved: any[];
let exchanges: number;

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  if (url.includes("/rest/v1/profiles")) {
    const uid = /firebase_uid=eq\.([^&]+)/.exec(url)?.[1];
    const pid = /[?&]id=eq\.([^&]+)/.exec(url)?.[1];
    return ok(people.filter((p) => p.firebase === uid || p.id === pid));
  }
  if (url.includes("/rest/v1/hr_google_drive_connections") && init?.method === "POST") {
    saved.push(JSON.parse(String(init.body)));
    return Promise.resolve(new Response(null, { status: 201 }));
  }
  if (url === "https://oauth2.googleapis.com/token") {
    exchanges++;
    return ok({ refresh_token: "rt-new", access_token: "at-new" });
  }
  throw new Error(`Unexpected fetch in test: ${url}`);
}

const get = (query: string) => handleGoogleDriveRequest(new Request(`https://app.test/api/google-drive?${query}`), ENV);
const start = (uid: string) => get(`action=connect&idToken=${uid}`);
const callback = (state: string) => get(`code=abc&state=${encodeURIComponent(state)}`);
const stateFrom = (res: Response) => new URL(res.headers.get("location")!).searchParams.get("state")!;
const encode = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const decode = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

beforeEach(() => {
  saved = [];
  exchanges = 0;
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Google Drive connect", () => {
  it("saves a normal connect under the Admin who started it, with their name from their profile", async () => {
    const res = await callback(stateFrom(await start("admin")));
    expect(res.headers.get("location")).toContain("driveConnected=1");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ company_id: COMPANY, connected_by: "p-admin", connected_by_name: "Ada Admin", refresh_token: "rt-new" });
  });

  it("keeps a non-Admin out, as before", async () => {
    expect((await start("hr")).status).toBe(403);
  });

  it("refuses a made-up callback in the old format, before it ever talks to Google", async () => {
    const res = await callback(encode({ companyId: COMPANY, profileId: "p-admin", connectedByName: "Ada Admin" }));
    expect(res.headers.get("location")).toContain("driveConnected=0");
    expect(exchanges).toBe(0);
    expect(saved).toHaveLength(0);
  });

  it.each([
    ["another company", { companyId: OTHER_COMPANY }],
    ["another person", { profileId: "p-hr" }],
  ])("refuses a real state altered to name %s", async (_what, change) => {
    const [body, sig] = stateFrom(await start("admin")).split(".");
    const res = await callback(`${encode({ ...decode(body), ...change })}.${sig}`);
    expect(res.headers.get("location")).toContain("driveConnected=0");
    expect(exchanges).toBe(0);
    expect(saved).toHaveLength(0);
  });

  it("refuses a state over 15 minutes old", async () => {
    const state = stateFrom(await start("admin"));
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 16 * 60 * 1000);
    const res = await callback(state);
    expect(res.headers.get("location")).toContain("driveConnected=0");
    expect(saved).toHaveLength(0);
  });

  it("refuses a signed state whose person isn't in that company", async () => {
    people.push({ firebase: "moved", id: "p-moved", company_id: COMPANY, role: "ADMIN", display_name: "Moved", username: null, email: "m@x.com" });
    const state = stateFrom(await start("moved"));
    people[people.length - 1].company_id = OTHER_COMPANY;
    const res = await callback(state);
    people.pop();
    expect(res.headers.get("location")).toContain("driveConnected=0");
    expect(saved).toHaveLength(0);
  });
});
