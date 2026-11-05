import { describe, expect, it } from "vitest";
import {
  HIRING_EMAIL_KINDS,
  HIRING_EMAIL_TEMPLATES,
  NO_SIGNATURE,
  carryFieldChanges,
  congratsBody,
  congratsSubject,
  defaultSignatureId,
  emailBodyHtml,
  emailFieldProblem,
  formatLocationAddress,
  formatOrientationTime,
  greetingName,
  hasUnfilledPlaceholder,
  interviewReminderBody,
  isTechnicianPosition,
  isValidEmail,
  isValidLink,
  latestDiscordLink,
  normalizeLink,
  parseEmailList,
  parseSignatureImage,
  positionTitles,
  prefillEmailFields,
  screeningPassedBody,
  selectableSignatures,
  statusUpdateBody,
  technicianCongratsBody,
  type EmailFields,
  type EmailPrefillSource,
} from "./hiringEmails";

const filled: EmailFields = {
  name: "Ana",
  position: "CSR Associate",
  date: "2026-11-10",
  time: "13:30",
  zone: "CST",
  location: "100 Main St, Atlanta, GA 30301",
  contactPerson: "Alyssa Diones",
  contactNumber: "555-0100",
  username: "Ana.Cruz",
  password: "typed-by-hr",
  discordLink: "https://discord.gg/abc123",
};

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
    expect(body).toContain("\nDiscord Link: https://discord.gg/abc123\n");
    expect(body.endsWith("\n\nBest regards,")).toBe(true);
    expect(hasUnfilledPlaceholder(body)).toBe(false);
  });
  it("uses 'an' before a vowel", () => {
    expect(congratsBody({ ...filled, position: "Inventory Clerk" })).toContain("as an Inventory Clerk.");
  });
  it("stays flagged until the date and time are declared", () => {
    expect(hasUnfilledPlaceholder(congratsBody({ ...filled, date: "" }))).toBe(true);
    expect(hasUnfilledPlaceholder(congratsBody({ ...filled, time: "" }))).toBe(true);
    expect(hasUnfilledPlaceholder(congratsBody({ ...filled, position: "" }))).toBe(true);
    expect(hasUnfilledPlaceholder(congratsBody({ ...filled, discordLink: " " }))).toBe(true);
  });
});

describe("carryFieldChanges", () => {
  const before = { ...filled, date: "", time: "", discordLink: "" };
  it("rebuilds an untouched draft", () => {
    expect(carryFieldChanges(congratsBody(before), congratsBody(before), congratsBody(filled))).toBe(congratsBody(filled));
  });
  it("updates only the lines that changed in a hand-edited draft", () => {
    const edited = congratsBody(before).replace("Please ensure", "Kindly ensure");
    const out = carryFieldChanges(edited, congratsBody(before), congratsBody(filled));
    expect(out).toContain("Kindly ensure");
    expect(out).toContain("\nDate: November 10, 2026\n");
    expect(out).toContain("\nTime: 1:30 PM CST\n");
    expect(out).toContain("\nDiscord Link: https://discord.gg/abc123\n");
    expect(hasUnfilledPlaceholder(out)).toBe(false);
  });
  it("updates a link on its own line, as in the Technician email", () => {
    const edited = technicianCongratsBody(filled).replace("Please complete the following", "Please finish the following");
    const out = carryFieldChanges(edited, technicianCongratsBody(filled), technicianCongratsBody({ ...filled, discordLink: "discord.gg/new" }));
    expect(out).toContain("\n\nhttps://discord.gg/new\n\n");
    expect(out).toContain("Please finish the following");
  });
  it("leaves a line HR rewrote themselves", () => {
    const edited = congratsBody(filled).replace("Date: November 10, 2026", "Date: Tuesday the 10th");
    const out = carryFieldChanges(edited, congratsBody(filled), congratsBody({ ...filled, date: "2026-11-12" }));
    expect(out).toContain("Date: Tuesday the 10th");
  });
});

describe("Technician email", () => {
  const body = technicianCongratsBody(filled);
  it("fills in every field where your template has it", () => {
    expect(body.startsWith("Hi Ana,\n\nCongratulations! We are pleased")).toBe(true);
    expect(body).toContain("Training Details\n\nDate: November 10, 2026\nTime: 1:30 PM CST\nLocation: 100 Main St, Atlanta, GA 30301\nContact Person: Alyssa Diones\nContact Number: 555-0100\n");
    expect(body).toContain("   Link: https://adminhubsolution.com/\n   Username: Ana.Cruz\n   Password: typed-by-hr\n");
    expect(body).toContain("   Unique ID: USIHS\n");
    expect(body).toContain("on your scheduled orientation day:\n\nhttps://discord.gg/abc123\n\nOnce you join");
    expect(body.endsWith("\n\nBest regards,")).toBe(true);
    expect(hasUnfilledPlaceholder(body)).toBe(false);
  });
  it("no longer has the leftover schedule-change line", () => {
    expect(body).not.toContain("schedule change");
  });
  it.each(["date", "time", "location", "contactPerson", "contactNumber", "username", "password", "discordLink"] as const)("flags an empty %s", (key) => {
    expect(hasUnfilledPlaceholder(technicianCongratsBody({ ...filled, [key]: "" }))).toBe(true);
  });
  it("has a fixed Technician subject", () => {
    expect(HIRING_EMAIL_TEMPLATES.congratulations_technician.subject(filled, "2026-11-01")).toBe("Congratulations! Welcome to US In Home Services – Technician Position");
  });
});

describe("Passed Screening Interview email", () => {
  it("fills in the date, time and link", () => {
    const body = screeningPassedBody(filled);
    expect(body.startsWith("Hi Ana,\n\nCongratulations! We’re pleased to let you know that you’ve successfully passed the screening interview.")).toBe(true);
    expect(body).toContain("Date: November 10, 2026\nTime: 1:30 PM CST\nDiscord link: https://discord.gg/abc123\n");
    expect(body).toContain("Example: John_Smith_INTERVIEW");
    expect(hasUnfilledPlaceholder(body)).toBe(false);
  });
});

describe("Interview Reminder email", () => {
  it("says today when it's today", () => {
    expect(interviewReminderBody(filled, "2026-11-10")).toContain("scheduled for today, November 10, 2026, at 1:30 PM CST.");
  });
  it("doesn't say today for another day", () => {
    expect(interviewReminderBody(filled, "2026-11-09")).toContain("scheduled for November 10, 2026, at 1:30 PM CST.");
  });
  it("puts the date in the subject", () => {
    expect(HIRING_EMAIL_TEMPLATES.interview_reminder.subject(filled, "2026-11-09")).toBe("Interview Reminder – November 10, 2026 at 1:30 PM CST");
  });
});

describe("emailFieldProblem", () => {
  const today = "2026-11-05";
  it("is clear once everything's filled in", () => {
    for (const kind of HIRING_EMAIL_KINDS) expect(emailFieldProblem(kind, filled, today)).toBeNull();
  });
  it("uses the right word for each email's date", () => {
    const blank = { ...filled, date: "" };
    expect(emailFieldProblem("congratulations", blank, today)).toBe("Pick the orientation date.");
    expect(emailFieldProblem("congratulations_technician", blank, today)).toBe("Pick the training date.");
    expect(emailFieldProblem("screening_passed", blank, today)).toBe("Pick the interview date.");
  });
  it("refuses a date that's passed, but allows today", () => {
    expect(emailFieldProblem("interview_reminder", { ...filled, date: "2026-11-04" }, today)).toBe("The interview date has already passed.");
    expect(emailFieldProblem("interview_reminder", { ...filled, date: today }, today)).toBeNull();
  });
  it("asks for each Technician field", () => {
    const tech = (patch: Partial<EmailFields>) => emailFieldProblem("congratulations_technician", { ...filled, ...patch }, today);
    expect(tech({ location: " " })).toBe("Enter the location.");
    expect(tech({ contactPerson: "" })).toBe("Enter the contact person.");
    expect(tech({ contactNumber: "" })).toBe("Enter the contact number.");
    expect(tech({ username: "" })).toBe("Enter the username.");
    expect(tech({ password: " " })).toBe("Enter the password.");
    expect(tech({ discordLink: "" })).toBe("Enter the Discord link.");
    expect(tech({ discordLink: "tomorrow" })).toContain("Check the Discord link");
  });
  it("needs nothing for the Status Update", () => {
    const empty = { ...filled, date: "", time: "", location: "", contactPerson: "", contactNumber: "", username: "", password: "", discordLink: "", position: "" };
    expect(emailFieldProblem("status_update", empty, today)).toBeNull();
  });
});

describe("prefillEmailFields", () => {
  const today = "2026-11-05";
  const src: EmailPrefillSource = {
    candidateName: "ANA MARIE DELA CRUZ",
    position: " Technician ",
    interviewDate: "2026-11-06",
    interviewTime: "09:30",
    interviewTimezone: "EST",
    trainingStartDate: "2026-11-09",
    startDate: "2026-11-20",
    trainingTimeIn: "08:00",
    location: "100 Main St, Atlanta, GA 30301",
    contactPerson: "Alyssa Diones",
    contactNumber: "555-0100",
    username: "ANA.CRUZ",
    lastDiscordLink: null,
  };
  it("fills the name, position, contact, location and username", () => {
    const f = prefillEmailFields("congratulations_technician", src, today);
    expect(f).toMatchObject({ name: "Ana Marie", position: "Technician", location: src.location, contactPerson: "Alyssa Diones", contactNumber: "555-0100", username: "ANA.CRUZ" });
  });
  it("uses the interview date and time for interview emails", () => {
    for (const kind of ["screening_passed", "interview_reminder"] as const) {
      expect(prefillEmailFields(kind, src, today)).toMatchObject({ date: "2026-11-06", time: "09:30", zone: "EST" });
    }
  });
  it("uses the training date and time for congratulatory emails, then the start date", () => {
    expect(prefillEmailFields("congratulations", src, today)).toMatchObject({ date: "2026-11-09", time: "08:00" });
    expect(prefillEmailFields("congratulations", { ...src, trainingStartDate: null }, today).date).toBe("2026-11-20");
  });
  it("leaves out a date that's passed, and its time", () => {
    const f = prefillEmailFields("interview_reminder", { ...src, interviewDate: "2026-11-01" }, today);
    expect(f.date).toBe("");
    expect(f.time).toBe("");
  });
  it("keeps today's date", () => {
    expect(prefillEmailFields("interview_reminder", { ...src, interviewDate: today }, today).date).toBe(today);
  });
  it("never fills in the password", () => {
    for (const kind of HIRING_EMAIL_KINDS) expect(prefillEmailFields(kind, src, today).password).toBe("");
  });
  it("starts Technician training at 8:00 AM CST if no time is saved", () => {
    const f = prefillEmailFields("congratulations_technician", { ...src, trainingTimeIn: null }, today);
    expect(f).toMatchObject({ time: "08:00", zone: "CST" });
    expect(technicianCongratsBody(f)).toContain("Time: 8:00 AM CST\n");
  });
  it("uses a saved training time over that default", () => {
    expect(prefillEmailFields("congratulations_technician", { ...src, trainingTimeIn: "09:15" }, today)).toMatchObject({ time: "09:15", zone: "EST" });
  });
  it("still defaults the time when an old date is dropped", () => {
    expect(prefillEmailFields("congratulations_technician", { ...src, trainingStartDate: "2026-11-01", startDate: null }, today)).toMatchObject({ date: "", time: "08:00", zone: "CST" });
  });
  it("only defaults the time for Technician training", () => {
    expect(prefillEmailFields("congratulations", { ...src, trainingTimeIn: null }, today).time).toBe("");
    expect(prefillEmailFields("screening_passed", { ...src, interviewTime: null }, today).time).toBe("");
  });
  it("defaults the time zone to CST", () => {
    expect(prefillEmailFields("congratulations", { ...src, interviewTimezone: null }, today).zone).toBe("CST");
  });
  it("starts each email on its own invite from your templates", () => {
    expect(prefillEmailFields("congratulations", src, today).discordLink).toBe("https://discord.gg/nEbbTFxRa");
    expect(prefillEmailFields("congratulations_technician", src, today).discordLink).toBe("https://discord.gg/7xx2R7TYc");
    expect(prefillEmailFields("screening_passed", src, today).discordLink).toBe("https://discord.gg/cZ42d28Dr");
    expect(prefillEmailFields("interview_reminder", src, today).discordLink).toBe("https://discord.gg/cZ42d28Dr");
    expect(prefillEmailFields("status_update", src, today).discordLink).toBe("");
  });
  it("prefers the latest link anyone sent", () => {
    expect(prefillEmailFields("congratulations", { ...src, lastDiscordLink: "https://discord.gg/newer" }, today).discordLink).toBe("https://discord.gg/newer");
  });
});

describe("latestDiscordLink", () => {
  const sent = [
    { kind: "congratulations" as const, discordLink: "https://discord.gg/old", date: "2026-11-01T10:00:00Z" },
    { kind: "congratulations" as const, discordLink: "https://discord.gg/new", date: "2026-11-03T10:00:00Z" },
    { kind: "congratulations" as const, discordLink: "", date: "2026-11-04T10:00:00Z" },
    { kind: "screening_passed" as const, discordLink: "https://discord.gg/screen", date: "2026-11-02T10:00:00Z" },
    { kind: "status_update" as const, discordLink: "", date: "2026-11-05T10:00:00Z" },
  ];
  it("takes the newest for that email", () => {
    expect(latestDiscordLink(sent, "congratulations")).toBe("https://discord.gg/new");
  });
  it("shares one link across the two interview emails", () => {
    expect(latestDiscordLink(sent, "interview_reminder")).toBe("https://discord.gg/screen");
  });
  it("is nothing when none has gone out", () => {
    expect(latestDiscordLink(sent, "congratulations_technician")).toBeNull();
    expect(latestDiscordLink([], "congratulations")).toBeNull();
  });
});

describe("branch address and position checks", () => {
  it("joins what's there", () => {
    expect(formatLocationAddress({ address1: "100 Main St", address2: " Suite 5 ", city: "Atlanta", state: "GA", zipCode: "30301" })).toBe("100 Main St, Suite 5, Atlanta, GA 30301");
    expect(formatLocationAddress({ address1: "100 Main St", address2: "", city: "", state: "GA", zipCode: "" })).toBe("100 Main St, GA");
    expect(formatLocationAddress({ address1: " ", address2: "", city: "", state: "", zipCode: "" })).toBe("");
  });
  it("spots a technician position, even the misspelled one on file", () => {
    expect(isTechnicianPosition("Technician")).toBe(true);
    expect(isTechnicianPosition("Technicain")).toBe(true);
    expect(isTechnicianPosition("Parts Manager")).toBe(false);
    expect(isTechnicianPosition(null)).toBe(false);
  });
});

describe("discord link", () => {
  it("adds https:// to a pasted address and leaves a full one alone", () => {
    expect(normalizeLink(" discord.gg/abc123 ")).toBe("https://discord.gg/abc123");
    expect(normalizeLink("https://discord.gg/abc123")).toBe("https://discord.gg/abc123");
    expect(normalizeLink("HTTPS://discord.gg/abc123")).toBe("HTTPS://discord.gg/abc123");
    expect(normalizeLink("  ")).toBe("");
    expect(congratsBody({ ...filled, discordLink: "discord.gg/abc123" })).toContain("\nDiscord Link: https://discord.gg/abc123\n");
  });
  it.each(["https://discord.gg/abc123", "discord.gg/abc123", "https://discord.com/invite/abc123", "https://discord.gg"])("accepts %s", (link) => {
    expect(isValidLink(link)).toBe(true);
  });
  it.each(["", "   ", "tomorrow", "abc123", "https://", "https://discord", "discord.gg/abc 123", "https://discord.gg/abc\nBcc: x"])("refuses %j", (link) => {
    expect(isValidLink(link)).toBe(false);
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

describe("sign-off", () => {
  it("ends every email on Best regards, with nothing after it", () => {
    for (const kind of HIRING_EMAIL_KINDS) {
      const body = HIRING_EMAIL_TEMPLATES[kind].body(filled, "2026-11-05");
      expect(body.endsWith("\n\nBest regards,")).toBe(true);
      expect(body).not.toContain("HR Team USIHS");
    }
  });
});

describe("statusUpdateBody", () => {
  it("greets by name and signs off", () => {
    const body = statusUpdateBody("John Michael");
    expect(body.startsWith("Dear John Michael,\n")).toBe(true);
    expect(body).toContain("we regret to inform you");
    expect(body.endsWith("Best regards,")).toBe(true);
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
  it("keeps a list's indented lines indented", () => {
    expect(emailBodyHtml("2. Log in:\n   Username: Ana.Cruz", "s")).toContain("<br>\n&nbsp;&nbsp;&nbsp;Username: Ana.Cruz");
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
