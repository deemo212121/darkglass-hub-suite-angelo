import { describe, expect, it } from "vitest";
import { mostUsedIp } from "./termsAccept";

describe("the usual sign-in IP an acceptance is compared with", () => {
  it("is the one used most", () => {
    expect(mostUsedIp(["1.1.1.1", "2.2.2.2", "2.2.2.2", null, "1.1.1.1", "2.2.2.2"])).toBe("2.2.2.2");
  });

  it("goes to the more recent one on a tie (newest first)", () => {
    expect(mostUsedIp(["3.3.3.3", "4.4.4.4", "4.4.4.4", "3.3.3.3"])).toBe("3.3.3.3");
  });

  it("is nothing without sign-in history", () => {
    expect(mostUsedIp([])).toBeNull();
    expect(mostUsedIp([null, undefined])).toBeNull();
  });
});
