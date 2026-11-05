import { describe, expect, it } from "vitest";
import {
  NO_SIGNATURE,
  defaultSignatureId,
  emailBodyHtml,
  parseSignatureImage,
  selectableSignatures,
  congratsBody,
  congratsSubject,
  formatOrientationTime,
  greetingName,
  hasUnfilledPlaceholder,
  isValidEmail,
  parseEmailList,
  patchCongratsLines,
  positionTitles,
  statusUpdateBody,
  type CongratsFields,
} from "./hiringEmails";

const filled: CongratsFields = { name: "Ana", position: "CSR Associate", date: "2026-11-10", time: "13:30", zone: "CST" };

describe("greetingName", () => {
  it.each([
    ["Ana Cruz", "Ana"],
    ["John Michael Santos", "John Michael"],
    ["Ana Dela Cruz", "Ana"],
    ["Maria De La Cruz", "Maria"],
    ["ANA MARIE REYES", "Ana Marie"],
    ["Cruz, Ana Marie", "Ana Marie"],
    ["Juan Reyes Jr.", "Juan"],
    ["Madonna", "Madonna"],
    ["  ana   cruz ", "Ana"],
    ["Mary-Jane Watson", "Mary-Jane"],
  ])("%s → %s", (full, expected) => {
    expect(greetingName(full)).toBe(expected);
  });
});

describe("positionTitles", () => {
  it("spells out CSR in the body and keeps it short in the subject", () => {
    expect(positionTitles("CSR Associate")).toEqual({ full: "Customer Service Representative (CSR)", short: "CSR" });
    expect(congratsSubject("CSR Associate")).toBe("Congratulations! Welcome to US In Home Services – CSR Position");
  });
  it("leaves other positions as declared, including a CSR Manager", () => {
    expect(positionTitles("Technician")).toEqual({ full: "Technician", short: "Technician" });
    expect(positionTitles("CSR Manager").full).toBe("CSR Manager");
    expect(congratsSubject("Parts Manager")).toBe("Congratulations! Welcome to US In Home Services – Parts Manager Position");
  });
});

describe("congratsBody", () => {
  it("fills in the name, position, date and time", () => {
    const body = congratsBody(filled);
    expect(body.startsWith("Hi Ana,\n")).toBe(true);
    expect(body).toContain("join US In Home Services as a Customer Service Representative (CSR).");
    expect(body).toContain("\nPosition: Customer Service Representative (CSR)\n");
    expect(body).toContain("\nDate: November 10, 2026\n");
    expect(body).toContain("\nTime: 1:30 PM CST\n");
    expect(body).toContain("\nDiscord Link: https://discord.gg/nEbbTFxRa\n");
    expect(body.endsWith("Best regards,\nHR Team USIHS")).toBe(true);
    expect(hasUnfilledPlaceholder(body)).toBe(false);
  });
  it("uses 'an' before a vowel", () => {
    expect(congratsBody({ ...filled, position: "Inventory Clerk" })).toContain("as an Inventory Clerk.");
  });
  it("stays flagged until the date and time are declared", () => {
    expect(hasUnfilledPlaceholder(congratsBody({ ...filled, date: "" }))).toBe(true);
    expect(hasUnfilledPlaceholder(congratsBody({ ...filled, time: "" }))).toBe(true);
    expect(hasUnfilledPlaceholder(congratsBody({ ...filled, position: "" }))).toBe(true);
  });
  it("updates only the field lines of a hand-edited draft", () => {
    const edited = congratsBody({ ...filled, date: "", time: "" }).replace("Please ensure", "Kindly ensure");
    const patched = patchCongratsLines(edited, filled);
    expect(patched).toContain("Kindly ensure");
    expect(patched).toContain("\nDate: November 10, 2026\n");
    expect(patched).toContain("\nTime: 1:30 PM CST\n");
    expect(hasUnfilledPlaceholder(patched)).toBe(false);
  });
});

describe("formatOrientationTime", () => {
  it.each([
    ["00:05", "12:05 AM EST"],
    ["09:00", "9:00 AM EST"],
    ["12:00", "12:00 PM EST"],
    ["23:45", "11:45 PM EST"],
  ])("%s → %s", (time, expected) => {
    expect(formatOrientationTime(time, "EST")).toBe(expected);
  });
});

describe("statusUpdateBody", () => {
  it("greets by name and signs off", () => {
    const body = statusUpdateBody("John Michael");
    expect(body.startsWith("Dear John Michael,\n")).toBe(true);
    expect(body).toContain("we regret to inform you");
    expect(body.endsWith("Best regards,\nHR Team USIHS")).toBe(true);
  });
});

describe("signature list", () => {
  const sig = (id: string, name: string, mine: boolean, shared: boolean) => ({ id, name, mine, shared });
  const list = [sig("t", "HR Team", false, true), sig("b", "Bea", false, false), sig("z", "Ana Work", true, false), sig("a", "Ana Home", true, true)];

  it("offers your own first, then shared, never a coworker's private one", () => {
    expect(selectableSignatures(list).map((s) => s.id)).toEqual(["a", "z", "t"]);
  });
  it("starts on the last one used, if it's still there", () => {
    const selectable = selectableSignatures(list);
    expect(defaultSignatureId(selectable, "t")).toBe("t");
    expect(defaultSignatureId(selectable, "gone")).toBe("a");
    expect(defaultSignatureId(selectable, "b")).toBe("a");
    expect(defaultSignatureId(selectable, null)).toBe("a");
  });
  it("stays on None if that's what was last used, or there's nothing to pick", () => {
    expect(defaultSignatureId(selectableSignatures(list), NO_SIGNATURE)).toBe("");
    expect(defaultSignatureId([], null)).toBe("");
    expect(defaultSignatureId([], "t")).toBe("");
  });
});

describe("signature photo", () => {
  it("accepts only the image types an email can show, as clean base64", () => {
    expect(parseSignatureImage("data:image/png;base64,QUJD+/==")).toEqual({ mimeType: "image/png", base64: "QUJD+/==" });
    expect(parseSignatureImage("data:image/jpeg;base64,QUJD")?.mimeType).toBe("image/jpeg");
    expect(parseSignatureImage("data:image/svg+xml;base64,QUJD")).toBeNull();
    expect(parseSignatureImage("data:image/png;base64,QUJD\r\nX-Evil: 1")).toBeNull();
    expect(parseSignatureImage("https://example.com/a.png")).toBeNull();
    expect(parseSignatureImage(null)).toBeNull();
  });
  it("puts the photo after the last line of the email", () => {
    const html = emailBodyHtml("Hi Ana,\n\nBest regards,\nHR Team USIHS\n\n", "sig1");
    expect(html.indexOf("HR Team USIHS")).toBeLessThan(html.indexOf('src="cid:sig1"'));
    expect(html).toContain("Hi Ana,<br>");
    expect(html).toContain('<br>\nHR Team USIHS<br><br><img');
  });
  it("escapes what HR typed and keeps links clickable", () => {
    const html = emailBodyHtml('A <b>"bold"</b> & more. See https://discord.gg/nEbbTFxRa.', "s");
    expect(html).toContain("A &lt;b&gt;&quot;bold&quot;&lt;/b&gt; &amp; more.");
    expect(html).toContain('<a href="https://discord.gg/nEbbTFxRa">https://discord.gg/nEbbTFxRa</a>.');
  });
});

describe("addresses", () => {
  it("rejects anything that could add a mail header or a second address", () => {
    expect(isValidEmail("ana@example.com")).toBe(true);
    expect(isValidEmail("ana@example.com\r\nBcc: x@y.com")).toBe(false);
    expect(isValidEmail("ana@example.com, b@example.com")).toBe(false);
    expect(isValidEmail("ana@example")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
  it("splits a CC box on commas, semicolons and spaces", () => {
    expect(parseEmailList(" a@x.com, b@x.com;c@x.com  d@x.com ")).toEqual(["a@x.com", "b@x.com", "c@x.com", "d@x.com"]);
    expect(parseEmailList("  ")).toEqual([]);
  });
});
