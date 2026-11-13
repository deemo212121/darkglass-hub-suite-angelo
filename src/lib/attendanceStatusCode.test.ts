import { describe, it, expect } from "vitest";
import { autoClockOutInfo } from "./attendanceStatusCode";

describe("autoClockOutInfo", () => {
  it("reads the end-of-day forced clock-out and what the system went by", () => {
    const notes = "[Auto clock-out 17:00:00 — scheduled end of shift; still clocked in at end of 2026-11-12 (system)]";
    expect(autoClockOutInfo(notes)).toEqual({ auto: true, time: "17:00", reviewedBy: null, reason: "Scheduled end of shift" });
  });

  it("reads the arrived-home clock-out and HR's review", () => {
    const notes =
      "Running late\n[Auto clock-out 16:42:10 — arrived home (within 1 mi); last ticket SA-123; system]\n[Reviewed auto clock-out — Jane Doe]";
    expect(autoClockOutInfo(notes)).toEqual({ auto: true, time: "16:42", reviewedBy: "Jane Doe", reason: "Arrived home (within 1 mi)" });
  });

  it("keeps the Work Done wording as written", () => {
    expect(autoClockOutInfo("[Auto clock-out 15:10:00 — last Work Start (never marked done); still clocked in at end of 2026-11-11 (system)]").reason).toBe(
      "Last Work Start (never marked done)",
    );
  });

  it("is not a system clock-out without the marker", () => {
    expect(autoClockOutInfo("Left early for appointment")).toEqual({ auto: false, time: null, reviewedBy: null, reason: null });
    expect(autoClockOutInfo(null).auto).toBe(false);
  });
});
