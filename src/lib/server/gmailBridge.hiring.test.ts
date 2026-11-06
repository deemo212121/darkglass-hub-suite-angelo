/**
 * Who can connect a Hiring Gmail and send from which account. fetch is replaced
 * for the whole file, and anything it doesn't recognize throws, so these can't
 * reach Google, Gmail or the database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabaseTokenBridge", async (importActual) => ({
  ...(await importActual<typeof import("./supabaseTokenBridge")>()),
  // The test's idToken is simply the caller's firebase uid.
  verifyFirebaseToken: vi.fn(async (idToken: string) => ({ sub: idToken })),
}));
vi.mock("./defaultPasswordBridge", () => ({ resolveDefaultPassword: vi.fn(async () => "default-pw") }));

import { handleGmailRequest } from "./gmailBridge";
import { resolveDefaultPassword } from "./defaultPasswordBridge";
import { DEFAULT_PASSWORD_MARKER, candidateEmailAction } from "../hiringEmails";

const COMPANY = "c0000000-0000-0000-0000-000000000001";
const OTHER_COMPANY = "c0000000-0000-0000-0000-000000000002";
const id = (n: number) => `a0000000-0000-0000-0000-00000000000${n}`;

const people: Record<string, { id: string; company_id: string; role: string; extra_roles: string[] | null; display_name: string; username: string | null; email: string; assigned_branch: string | null; technician_id: string | null }> = {};
const addPerson = (uid: string, profileId: string, role: string, extra: string[] = [], company = COMPANY) => {
  people[uid] = { id: profileId, company_id: company, role, extra_roles: extra, display_name: uid, username: null, email: `${uid}@x.com`, assigned_branch: null, technician_id: null };
};

const ANA = "p-ana", BEA = "p-bea", ADMIN = "p-admin", TECH = "p-tech", MGR = "p-mgr", EXTRA = "p-extra", OUTSIDER = "p-outsider";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==";
const ACCOUNTS: Record<string, { id: string; company_id: string; connected_by: string; connected_email: string; refresh_token: string; shared: boolean }> = {
  anaOwn: { id: id(1), company_id: COMPANY, connected_by: ANA, connected_email: "ana@usihs.com", refresh_token: "rt-ana", shared: false },
  beaPrivate: { id: id(2), company_id: COMPANY, connected_by: BEA, connected_email: "bea@usihs.com", refresh_token: "rt-bea", shared: false },
  hiringShared: { id: id(3), company_id: COMPANY, connected_by: BEA, connected_email: "hiring@usihs.com", refresh_token: "rt-shared", shared: true },
  otherCompany: { id: id(4), company_id: OTHER_COMPANY, connected_by: "p-x", connected_email: "x@other.com", refresh_token: "rt-x", shared: true },
  expired: { id: id(5), company_id: COMPANY, connected_by: ANA, connected_email: "old@usihs.com", refresh_token: "rt-expired", shared: false },
};
const sigId = (n: number) => `b0000000-0000-0000-0000-00000000000${n}`;
const IMG = `data:image/png;base64,${PNG}`;
const SIGNATURES = {
  anaOwn: { id: sigId(1), company_id: COMPANY, created_by: ANA, shared: false, image: IMG },
  beaPrivate: { id: sigId(2), company_id: COMPANY, created_by: BEA, shared: false, image: IMG },
  team: { id: sigId(3), company_id: COMPANY, created_by: BEA, shared: true, image: IMG },
  otherCompany: { id: sigId(4), company_id: OTHER_COMPANY, created_by: "p-x", shared: true, image: IMG },
  broken: { id: sigId(5), company_id: COMPANY, created_by: ANA, shared: false, image: "data:image/png;base64,AB\r\nBcc: evil@x.com" },
};

let gmailSends: string[];
let upserts: any[];
let slotUpserts: any[];
let exchanges: number;

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));

  if (url.includes("/rest/v1/profiles")) {
    const uid = /firebase_uid=eq\.([^&]+)/.exec(url)?.[1];
    const pid = /[?&]id=eq\.([^&]+)/.exec(url)?.[1];
    const person = uid ? people[decodeURIComponent(uid)] : Object.values(people).find((p) => p.id === pid);
    return ok(person ? [person] : []);
  }
  if (url.includes("/rest/v1/hiring_gmail_accounts")) {
    if (init?.method === "POST") {
      upserts.push(JSON.parse(String(init.body)));
      return Promise.resolve(new Response(null, { status: 201 }));
    }
    const wanted = /id=eq\.([^&]+)/.exec(url)?.[1];
    return ok(Object.values(ACCOUNTS).filter((a) => a.id === wanted));
  }
  if (url.includes("/rest/v1/hr_gmail_connections") && init?.method === "POST") {
    slotUpserts.push(JSON.parse(String(init.body)));
    return Promise.resolve(new Response(null, { status: 201 }));
  }
  if (url.includes("/rest/v1/gmail_connect_role_gates")) return ok([]);
  if (url.includes("/rest/v1/hiring_email_signatures")) {
    const wanted = /id=eq\.([^&]+)/.exec(url)?.[1];
    return ok(Object.values(SIGNATURES).filter((s) => s.id === wanted));
  }
  if (url.includes("/rest/v1/hr_candidates")) return ok([{ company_id: COMPANY }]);
  if (url === "https://oauth2.googleapis.com/token") {
    const form = String(init?.body);
    if (form.includes("grant_type=authorization_code")) {
      exchanges++;
      return ok({ refresh_token: "rt-new", access_token: "at-new" });
    }
    if (form.includes("rt-expired")) return Promise.resolve(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    return ok({ access_token: "at" });
  }
  if (url.includes("googleapis.com/oauth2/v2/userinfo")) return ok({ email: "New.Person@USIHS.com", name: "New Person" });
  if (url === "https://gmail.googleapis.com/gmail/v1/users/me/messages/send") {
    gmailSends.push(Buffer.from(JSON.parse(String(init?.body)).raw, "base64url").toString("utf8"));
    return ok({ id: "m1" });
  }
  throw new Error(`Unexpected fetch in test: ${url}`);
}

const ENV = {
  VITE_SUPABASE_URL: "https://db.test",
  SUPABASE_SERVICE_KEY: "service-key",
  VITE_FIREBASE_PROJECT_ID: "proj",
  GOOGLE_DRIVE_CLIENT_ID: "client-id",
  GOOGLE_DRIVE_CLIENT_SECRET: "client-secret",
};

const post = (action: string, payload: Record<string, unknown>) =>
  handleGmailRequest(new Request(`https://app.test/api/gmail?action=${action}`, { method: "POST", body: JSON.stringify(payload) }), ENV);

const email = (uid: string, accountId: string, extra: Record<string, unknown> = {}) =>
  post("send-candidate-email", { idToken: uid, accountId, candidateId: "cand-1", to: "cand@x.com", cc: "", subject: "Hello", body: "Hi there", ...extra });

beforeEach(() => {
  gmailSends = [];
  upserts = [];
  slotUpserts = [];
  exchanges = 0;
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (const k of Object.keys(people)) delete people[k];
  addPerson("ana", ANA, "HR");
  addPerson("bea", BEA, "HR");
  addPerson("admin", ADMIN, "ADMIN");
  addPerson("tech", TECH, "TECHNICIAN");
  addPerson("mgr", MGR, "MANAGER");
  addPerson("extra", EXTRA, "TECHNICIAN", ["HR"]);
  addPerson("outsider", OUTSIDER, "HR", [], OTHER_COMPANY);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("send-candidate-email: which account", () => {
  it("sends from your own account, as that address", async () => {
    const res = await email("ana", ACCOUNTS.anaOwn.id, { cc: "boss@x.com, hr@x.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sentTo: "cand@x.com", sentFrom: "ana@usihs.com" });
    expect(gmailSends).toHaveLength(1);
    expect(gmailSends[0]).toContain("From: ana@usihs.com\r\n");
    expect(gmailSends[0]).toContain("To: cand@x.com\r\n");
    expect(gmailSends[0]).toContain("Cc: boss@x.com, hr@x.com\r\n");
    expect(gmailSends[0]).toContain("Subject: Hello\r\n");
  });

  it("sends from an account shared with HR", async () => {
    const res = await email("ana", ACCOUNTS.hiringShared.id);
    expect(res.status).toBe(200);
    expect(gmailSends[0]).toContain("From: hiring@usihs.com\r\n");
  });

  it.each([
    ["another HR person", "ana"],
    ["an Admin", "admin"],
  ])("won't let %s send from someone's private account", async (_who, uid) => {
    const res = await email(uid, ACCOUNTS.beaPrivate.id);
    expect(res.status).toBe(403);
    expect(gmailSends).toHaveLength(0);
  });

  it("won't use an account from another company, even a shared one", async () => {
    const res = await email("ana", ACCOUNTS.otherCompany.id);
    expect(res.status).toBe(404);
    expect(gmailSends).toHaveLength(0);
  });

  it("needs an account to be picked", async () => {
    expect((await email("ana", "")).status).toBe(400);
    expect((await email("ana", "not-a-uuid")).status).toBe(400);
    expect(gmailSends).toHaveLength(0);
  });

  it("explains an expired connection and names the account", async () => {
    const res = await email("ana", ACCOUNTS.expired.id);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; reauthRequired: boolean };
    expect(body.reauthRequired).toBe(true);
    expect(body.error).toContain("old@usihs.com");
    expect(gmailSends).toHaveLength(0);
  });
});

describe("send-candidate-email: who and what", () => {
  it.each(["tech", "mgr"])("turns away %s", async (uid) => {
    const res = await email(uid, ACCOUNTS.hiringShared.id);
    expect(res.status).toBe(403);
    expect(gmailSends).toHaveLength(0);
  });

  it("counts HR held as an extra role", async () => {
    expect((await email("extra", ACCOUNTS.hiringShared.id)).status).toBe(200);
  });

  it("refuses a recipient or CC that could add a mail header", async () => {
    expect((await email("ana", ACCOUNTS.anaOwn.id, { to: "cand@x.com\r\nBcc: evil@x.com" })).status).toBe(400);
    expect((await email("ana", ACCOUNTS.anaOwn.id, { cc: "not an email" })).status).toBe(400);
    expect(gmailSends).toHaveLength(0);
  });

  it("flattens line breaks in the subject so it can't add a mail header", async () => {
    await email("ana", ACCOUNTS.anaOwn.id, { subject: "Hello\r\nBcc: evil@x.com" });
    expect(gmailSends[0]).toContain("Subject: Hello Bcc: evil@x.com\r\n");
    expect(gmailSends[0]).not.toContain("\r\nBcc:");
  });
});

/** One part of a signed email, decoded. */
const part = (raw: string, type: string) => {
  const m = new RegExp(`Content-Type: ${type}; charset=UTF-8\\r\\nContent-Transfer-Encoding: base64\\r\\n\\r\\n([A-Za-z0-9+/=\\r\\n]+?)\\r\\n\\r\\n--`).exec(raw);
  return m ? Buffer.from(m[1].replace(/\r\n/g, ""), "base64").toString("utf8") : null;
};

describe("send-candidate-email: the default password", () => {
  const lookups = vi.mocked(resolveDefaultPassword);
  const draft = `Hi Ana,\n\n   Username: Ana.Cruz\n   Password: ${DEFAULT_PASSWORD_MARKER}\n\nBest regards,`;
  const sendDraft = (uid: string, accountId: string, extra: Record<string, unknown> = {}) =>
    post(candidateEmailAction(draft), { idToken: uid, accountId, candidateId: "cand-1", to: "cand@x.com", cc: "", subject: "Hello", body: draft, ...extra });
  beforeEach(() => lookups.mockClear());

  it("puts the real password in the email and never sends it back to the page", async () => {
    const res = await sendDraft("ana", ACCOUNTS.anaOwn.id);
    expect(res.status).toBe(200);
    expect(gmailSends).toHaveLength(1);
    expect(gmailSends[0]).toContain("   Password: default-pw");
    expect(gmailSends[0]).not.toContain(DEFAULT_PASSWORD_MARKER);
    expect(JSON.stringify(await res.json())).not.toContain("default-pw");
  });

  it("uses the sender's own company's password", async () => {
    await sendDraft("ana", ACCOUNTS.anaOwn.id);
    expect(lookups).toHaveBeenCalledTimes(1);
    expect(lookups.mock.calls[0][1]).toBe(COMPANY);
  });

  it("fills in both the text and the HTML when there's a signature, escaping the HTML", async () => {
    lookups.mockResolvedValueOnce("Pa$&s<1>&2");
    const res = await sendDraft("ana", ACCOUNTS.anaOwn.id, { signatureId: SIGNATURES.anaOwn.id });
    expect(res.status).toBe(200);
    expect(part(gmailSends[0], "text/plain")).toContain("   Password: Pa$&s<1>&2\n");
    const html = part(gmailSends[0], "text/html")!;
    expect(html).toContain("Password: Pa$&amp;s&lt;1&gt;&amp;2");
    expect(html).not.toContain(DEFAULT_PASSWORD_MARKER);
  });

  it("sends nothing if no default password is set, rather than emailing the marker", async () => {
    lookups.mockResolvedValueOnce(null);
    const res = await sendDraft("ana", ACCOUNTS.anaOwn.id);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("Login Security");
    expect(gmailSends).toHaveLength(0);
  });

  it("leaves a password HR typed alone, without looking the default up", async () => {
    const res = await email("ana", ACCOUNTS.anaOwn.id, { body: "   Password: Typed1!\n\nBest regards," });
    expect(res.status).toBe(200);
    expect(gmailSends[0]).toContain("   Password: Typed1!");
    expect(gmailSends[0]).not.toContain("default-pw");
    expect(lookups).not.toHaveBeenCalled();
  });

  it.each([
    ["a technician", "tech", () => ACCOUNTS.hiringShared.id, 403],
    ["a manager", "mgr", () => ACCOUNTS.hiringShared.id, 403],
    ["HR at another company", "outsider", () => ACCOUNTS.hiringShared.id, 404],
    ["HR using a coworker's private Gmail", "ana", () => ACCOUNTS.beaPrivate.id, 403],
    ["HR picking no Gmail", "ana", () => "", 400],
  ])("doesn't read the password for %s", async (_who, uid, account, status) => {
    const res = await sendDraft(uid, account());
    expect(res.status).toBe(status);
    expect(lookups).not.toHaveBeenCalled();
    expect(gmailSends).toHaveLength(0);
  });
});

describe("send-candidate-email: signature", () => {
  const body = "Hi Ana,\n\nJoin: https://discord.gg/nEbbTFxRa\n\nWe’re glad ñ.\n\nBest regards,\nHR Team USIHS";

  it("embeds the saved photo after the sign-off, keeping the headers and a plain-text copy", async () => {
    const res = await email("ana", ACCOUNTS.anaOwn.id, { signatureId: SIGNATURES.anaOwn.id, body, cc: "boss@x.com", subject: "Welcome – CSR" });
    expect(res.status).toBe(200);
    const raw = gmailSends[0];
    expect(raw).toContain("From: ana@usihs.com\r\n");
    expect(raw).toContain("To: cand@x.com\r\n");
    expect(raw).toContain("Cc: boss@x.com\r\n");
    expect(raw).toContain(`Subject: =?UTF-8?B?${Buffer.from("Welcome – CSR").toString("base64")}?=\r\n`);
    expect(raw).toContain('Content-Type: multipart/related; boundary="');

    expect(part(raw, "text/plain")).toBe(body);
    const html = part(raw, "text/html")!;
    expect(html).toContain("We’re glad ñ.");
    expect(html).toContain('<a href="https://discord.gg/nEbbTFxRa">');
    const cid = /src="cid:([^"]+)"/.exec(html)![1];
    expect(html.indexOf("HR Team USIHS")).toBeLessThan(html.indexOf("cid:"));

    expect(raw).toContain(`Content-ID: <${cid}>\r\n`);
    expect(raw).toContain('Content-Disposition: inline; filename="signature.png"');
    expect(raw.replace(/\r\n/g, "")).toContain(PNG);
  });

  it("sends plain text when None is picked", async () => {
    await email("ana", ACCOUNTS.anaOwn.id, { signatureId: "", body });
    expect(gmailSends[0]).toContain("Content-Type: text/plain; charset=UTF-8\r\n\r\nHi Ana,");
    expect(gmailSends[0]).not.toContain("multipart");
    expect(gmailSends[0]).not.toContain(PNG);
  });

  it("isn't tied to the Gmail: a shared signature works from any account you can send from", async () => {
    const res = await email("ana", ACCOUNTS.hiringShared.id, { signatureId: SIGNATURES.team.id, body });
    expect(res.status).toBe(200);
    expect(gmailSends[0]).toContain("From: hiring@usihs.com\r\n");
    expect(gmailSends[0].replace(/\r\n/g, "")).toContain(PNG);
  });

  it.each([
    ["another HR person", "ana"],
    ["an Admin", "admin"],
  ])("won't let %s sign with a coworker's private signature", async (_who, uid) => {
    const account = uid === "ana" ? ACCOUNTS.anaOwn.id : ACCOUNTS.hiringShared.id;
    const res = await email(uid, account, { signatureId: SIGNATURES.beaPrivate.id, body });
    expect(res.status).toBe(403);
    expect(gmailSends).toHaveLength(0);
  });

  it.each([
    ["from another company, even a shared one", () => SIGNATURES.otherCompany.id, 404],
    ["that's been removed", () => sigId(9), 404],
    ["that isn't a real id", () => "not-a-uuid", 404],
    ["with an unusable photo", () => SIGNATURES.broken.id, 409],
  ])("stops rather than sending without it, for a signature %s", async (_what, signature, status) => {
    const res = await email("ana", ACCOUNTS.anaOwn.id, { signatureId: signature(), body });
    expect(res.status).toBe(status);
    expect(gmailSends).toHaveLength(0);
  });

  it("checks the Gmail account first, so a shared signature doesn't open up a private Gmail", async () => {
    const res = await email("ana", ACCOUNTS.beaPrivate.id, { signatureId: SIGNATURES.team.id, body });
    expect(res.status).toBe(403);
    expect(gmailSends).toHaveLength(0);
  });

  it("ignores any image the page tries to supply", async () => {
    await email("ana", ACCOUNTS.anaOwn.id, { signatureId: SIGNATURES.anaOwn.id, body, image: "data:image/png;base64,RVZJTA==", signature_image: "RVZJTA==" });
    expect(gmailSends[0]).not.toContain("RVZJTA");
    expect(gmailSends[0].replace(/\r\n/g, "")).toContain(PNG);
  });
});

describe("connect: fixed Gmail slots (Payroll, Parts, IT, Attendance, Flash Tech)", () => {
  const start = (uid: string, region: string) => handleGmailRequest(new Request(`https://app.test/api/gmail?action=connect&region=${region}&idToken=${uid}`), ENV);
  const callback = (state: string) => handleGmailRequest(new Request(`https://app.test/api/gmail?code=abc&state=${encodeURIComponent(state)}`), ENV);
  const stateFrom = (res: Response) => new URL(res.headers.get("location")!).searchParams.get("state")!;
  const encode = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const alter = (state: string, change: Record<string, unknown>) => {
    const [body, sig] = state.split(".");
    return `${encode({ ...JSON.parse(Buffer.from(body, "base64url").toString("utf8")), ...change })}.${sig}`;
  };

  it.each(["US", "PH", "PARTS", "IT_1", "IT_2", "IT_3", "ATTENDANCE", "FLASH_TECH"])("a normal %s connect saves under the Admin who started it", async (region) => {
    const res = await callback(stateFrom(await start("admin", region)));
    expect(res.headers.get("location")).toContain("gmailConnected=1");
    expect(slotUpserts).toEqual([
      { company_id: COMPANY, region, connected_by: ADMIN, connected_by_name: "admin", connected_account_name: "New Person", connected_email: "New.Person@USIHS.com", refresh_token: "rt-new" },
    ]);
  });

  it("keeps someone without access out, as before", async () => {
    expect((await start("ana", "US")).status).toBe(403);
    expect((await start("tech", "US")).status).toBe(403);
  });

  it("refuses a made-up callback in the old format, before it ever talks to Google", async () => {
    const forged = encode({ companyId: COMPANY, profileId: ADMIN, connectedByName: "Someone", region: "US" });
    const res = await callback(forged);
    expect(res.headers.get("location")).toContain("gmailConnected=0");
    expect(exchanges).toBe(0);
    expect(slotUpserts).toHaveLength(0);
  });

  it.each([
    ["another slot", { region: "PH" }],
    ["another company", { companyId: OTHER_COMPANY }],
    ["another person", { profileId: ANA }],
  ])("refuses a real state altered to name %s", async (_what, change) => {
    const res = await callback(alter(stateFrom(await start("admin", "US")), change));
    expect(res.headers.get("location")).toContain("gmailConnected=0");
    expect(exchanges).toBe(0);
    expect(slotUpserts).toHaveLength(0);
  });

  it("refuses a state over 15 minutes old, and still returns to the page it started from", async () => {
    const state = stateFrom(await start("admin", "ATTENDANCE"));
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 16 * 60 * 1000);
    const res = await callback(state);
    expect(res.headers.get("location")).toContain("/m/dashboard/attendance-monitoring");
    expect(res.headers.get("location")).toContain("gmailConnected=0");
    expect(slotUpserts).toHaveLength(0);
  });

  it("cancelling on Google's screen goes back to the right page and saves nothing", async () => {
    const state = stateFrom(await start("admin", "FLASH_TECH"));
    const res = await handleGmailRequest(new Request(`https://app.test/api/gmail?error=access_denied&state=${encodeURIComponent(state)}`), ENV);
    expect(res.headers.get("location")).toContain("/m/hr/flash-tech");
    expect(res.headers.get("location")).toContain("gmailConnected=0");
    expect(slotUpserts).toHaveLength(0);
  });
});

describe("send-hiring-credentials", () => {
  const creds = (uid: string, accountId: string) => post("send-hiring-credentials", { idToken: uid, profileId: TECH, accountId });

  it("sends from the picked account", async () => {
    const res = await creds("ana", ACCOUNTS.anaOwn.id);
    expect(res.status).toBe(200);
    expect(gmailSends[0]).toContain("From: ana@usihs.com\r\n");
    expect(gmailSends[0]).toContain("To: tech@x.com\r\n");
  });

  it("won't send from someone's private account", async () => {
    expect((await creds("ana", ACCOUNTS.beaPrivate.id)).status).toBe(403);
    expect(gmailSends).toHaveLength(0);
  });

  it("turns away a manager", async () => {
    expect((await creds("mgr", ACCOUNTS.hiringShared.id)).status).toBe(403);
  });
});

describe("connect-hiring-account", () => {
  const start = (uid: string) => handleGmailRequest(new Request(`https://app.test/api/gmail?action=connect-hiring-account&idToken=${uid}`), ENV);
  const callback = (state: string) => handleGmailRequest(new Request(`https://app.test/api/gmail?code=abc&state=${encodeURIComponent(state)}`), ENV);
  const stateFrom = (res: Response) => new URL(res.headers.get("location")!).searchParams.get("state")!;
  const encode = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const alter = (state: string, change: Record<string, unknown>) => {
    const [body, sig] = state.split(".");
    return `${encode({ ...JSON.parse(Buffer.from(body, "base64url").toString("utf8")), ...change })}.${sig}`;
  };

  it.each(["ana", "admin", "extra"])("lets %s connect, and shows Google's account chooser", async (uid) => {
    const res = await start(uid);
    expect(res.status).toBe(302);
    const google = new URL(res.headers.get("location")!);
    expect(google.hostname).toBe("accounts.google.com");
    expect(google.searchParams.get("prompt")).toBe("select_account consent");
  });

  it.each(["tech", "mgr"])("turns away %s", async (uid) => {
    expect((await start(uid)).status).toBe(403);
  });

  it("saves the account under the person who connected it, lower-cased and without touching shared", async () => {
    const res = await callback(stateFrom(await start("ana")));
    expect(res.headers.get("location")).toContain("gmailConnected=1");
    expect(res.headers.get("location")).toContain("tab=hiring");
    expect(upserts).toEqual([
      { company_id: COMPANY, connected_by: ANA, connected_by_name: "ana", connected_account_name: "New Person", connected_email: "new.person@usihs.com", refresh_token: "rt-new" },
    ]);
  });

  it.each([
    ["someone else's name", { profileId: BEA }],
    ["another company", { companyId: OTHER_COMPANY }],
    ["a fixed slot like Payroll", { hiringAccount: false, region: "US" }],
  ])("rejects a callback altered to use %s", async (_what, change) => {
    const res = await callback(alter(stateFrom(await start("ana")), change));
    expect(res.headers.get("location")).toContain("gmailConnected=0");
    expect(exchanges).toBe(0);
    expect(upserts).toHaveLength(0);
    expect(slotUpserts).toHaveLength(0);
  });

  it("rejects a state with its signature removed", async () => {
    const res = await callback(stateFrom(await start("ana")).split(".")[0]);
    expect(res.headers.get("location")).toContain("gmailConnected=0");
    expect(upserts).toHaveLength(0);
  });
});
