import { describe, expect, it } from "vitest";
import { audienceIsEmpty, audienceMatches, audienceText, bodyIsEmpty, draftChanged, hasAcceptedLatest, toAudience } from "./terms";

describe("audienceMatches", () => {
  const tech = { role: "TECHNICIAN", extra_roles: ["PARTS"], department: "Field", assigned_branch: "Jackson, MS" };
  it("Everyone matches anyone", () => {
    expect(audienceMatches({ everyone: true }, {})).toBe(true);
  });
  it("any one of roles / departments / branches", () => {
    expect(audienceMatches({ everyone: false, roles: ["technician"] }, tech)).toBe(true);
    expect(audienceMatches({ everyone: false, roles: ["Parts"] }, tech)).toBe(true);
    expect(audienceMatches({ everyone: false, departments: ["field"] }, tech)).toBe(true);
    expect(audienceMatches({ everyone: false, branches: ["Jackson,MS"] }, tech)).toBe(true);
    expect(audienceMatches({ everyone: false, roles: ["HR"], departments: ["Accounting"], branches: ["Raleigh"] }, tech)).toBe(false);
  });
  it("people with nothing filled in only get Everyone", () => {
    expect(audienceMatches({ everyone: false, departments: [""], branches: [""] }, {})).toBe(false);
  });
});

describe("toAudience / audienceText / audienceIsEmpty", () => {
  it("reads stored json", () => {
    expect(toAudience(null)).toEqual({ everyone: true });
    expect(toAudience({ everyone: false, roles: ["HR"] })).toEqual({ everyone: false, roles: ["HR"], departments: [], branches: [] });
    expect(audienceIsEmpty(toAudience({ everyone: false }))).toBe(true);
    expect(audienceText({ everyone: false, roles: ["HR"], branches: ["Raleigh"] })).toBe("HR · Raleigh");
  });
});

describe("hasAcceptedLatest", () => {
  const v = (id: string, version: number, requiresReaccept = true) => ({ id, version, requiresReaccept });
  it("nothing published → nothing to accept", () => {
    expect(hasAcceptedLatest([], new Set())).toBe(true);
  });
  it("must accept version 1", () => {
    expect(hasAcceptedLatest([v("a", 1)], new Set())).toBe(false);
    expect(hasAcceptedLatest([v("a", 1)], new Set(["a"]))).toBe(true);
  });
  it("a small fix doesn't ask again; a real change does", () => {
    expect(hasAcceptedLatest([v("a", 1), v("b", 2, false)], new Set(["a"]))).toBe(true);
    expect(hasAcceptedLatest([v("a", 1), v("b", 2, false), v("c", 3, true)], new Set(["a"]))).toBe(false);
    expect(hasAcceptedLatest([v("a", 1), v("b", 2, false), v("c", 3, true)], new Set(["c"]))).toBe(true);
  });
});

describe("draftChanged / bodyIsEmpty", () => {
  it("compares the draft with what's live", () => {
    const live = { title: "T", body: "<p>x</p>", audience: { everyone: true } };
    expect(draftChanged(live, undefined)).toBe(true);
    expect(draftChanged({ ...live }, live)).toBe(false);
    expect(draftChanged({ ...live, body: "<p>y</p>" }, live)).toBe(true);
    expect(bodyIsEmpty("<p></p>")).toBe(true);
    expect(bodyIsEmpty("<p>&nbsp;</p>")).toBe(true);
    expect(bodyIsEmpty("<p>Hi</p>")).toBe(false);
  });
});
