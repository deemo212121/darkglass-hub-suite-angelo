import { describe, expect, it } from "vitest";
import { peekOAuthState, readOAuthState, signOAuthState } from "./oauthState";

const SECRET = "server-secret";
const NOW = 1_800_000_000_000;
const MINUTE = 60 * 1000;
const claims = { companyId: "c1", profileId: "p1", region: "US" };
const read = (state: string, now = NOW, secret = SECRET, purpose = "gmail") => readOAuthState<typeof claims>(secret, purpose, state, now);
const encode = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const decode = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

describe("oauth state", () => {
  it("reads back what was signed", async () => {
    const state = await signOAuthState(SECRET, "gmail", claims, NOW);
    expect(await read(state)).toMatchObject(claims);
  });

  it.each([
    ["the company", { companyId: "c2" }],
    ["the person", { profileId: "p2" }],
    ["the slot", { region: "PH" }],
    ["its age", { iat: NOW + 5 * MINUTE }],
  ])("rejects a state with %s changed", async (_what, change) => {
    const [body, sig] = (await signOAuthState(SECRET, "gmail", claims, NOW)).split(".");
    expect(await read(`${encode({ ...decode(body), ...change })}.${sig}`)).toBeNull();
  });

  it("rejects a made-up state in the old unsigned format", async () => {
    expect(await read(encode({ ...claims, connectedByName: "Someone" }))).toBeNull();
  });

  it.each(["", ".", "abc", "abc.", ".abc", "abc.def", `${encode(claims)}.nothex`, `${encode(claims)}.${"0".repeat(64)}`, `not-base64!.${"a".repeat(64)}`])("rejects %j", async (state) => {
    expect(await read(state)).toBeNull();
  });

  it("rejects one signed with a different secret", async () => {
    expect(await read(await signOAuthState("other-secret", "gmail", claims, NOW))).toBeNull();
  });

  it("rejects one issued for a different kind of connection", async () => {
    expect(await read(await signOAuthState(SECRET, "google-drive", claims, NOW))).toBeNull();
  });

  it("accepts it up to 15 minutes, and not after", async () => {
    const state = await signOAuthState(SECRET, "gmail", claims, NOW);
    expect(await read(state, NOW + 15 * MINUTE)).not.toBeNull();
    expect(await read(state, NOW + 15 * MINUTE + 1)).toBeNull();
  });

  it("allows for a slightly fast clock, not a date in the future", async () => {
    const state = await signOAuthState(SECRET, "gmail", claims, NOW + 30 * 1000);
    expect(await read(state)).not.toBeNull();
    expect(await read(await signOAuthState(SECRET, "gmail", claims, NOW + 5 * MINUTE))).toBeNull();
  });

  it("peek reads either format for routing, and shrugs at junk", async () => {
    expect(peekOAuthState(await signOAuthState(SECRET, "gmail", claims, NOW))?.region).toBe("US");
    expect(peekOAuthState(encode({ region: "PH" }))?.region).toBe("PH");
    expect(peekOAuthState("not-base64!")).toBeNull();
    expect(peekOAuthState(null)).toBeNull();
  });
});
