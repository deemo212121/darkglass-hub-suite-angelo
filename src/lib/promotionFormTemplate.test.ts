import { describe, it, expect } from "vitest";
import { buildPromotionFormBodyMarkup, withPromotionNotificationDate, type PromotionFormData } from "./promotionFormTemplate";

const form: PromotionFormData = {
  employeeId: "p1",
  employeeName: "Sam Tech",
  currentPosition: "Technician",
  department: "Main",
  dateOfHire: "2026-07-27",
  roleChangeType: { promotion: false, positionTitleChange: false, departmentTransfer: false, technicianTierRaise: true, other: false, otherText: "" },
  newPositionTitle: "Tier 2",
  newDepartment: "",
  effectiveDate: "2026-10-05",
  wageAmount: "8.25",
  wageBasis: "hourly",
  performance: { meetsExpectations: true, exceedsExpectations: false, leadershipDemonstrated: false, trainingCompleted: false, other: false, otherText: "" },
  recipientSlot: "manager",
  recipientName: "",
};
const notificationLine = (html: string) => /Promotion Notification Date:<\/span> <strong>([^<]*)<\/strong>/.exec(html)?.[1];

describe("promotion notification date", () => {
  it("prints the notification date beside the date of hire", () => {
    const html = buildPromotionFormBodyMarkup({ ...form, notificationDate: "2026-09-28" }, "", {});
    expect(notificationLine(html)).toBe(new Date(2026, 8, 28).toLocaleDateString());
    expect(html.indexOf("Date of Hire:")).toBeLessThan(html.indexOf("Promotion Notification Date:"));
    expect(html.indexOf("Promotion Notification Date:")).toBeLessThan(html.indexOf("2. Role Change Details"));
  });
  it("uses the day an older form was sent, and never replaces a saved date", () => {
    expect(withPromotionNotificationDate(form, "2026-09-28T15:00:00Z").notificationDate).toBe("2026-09-28");
    expect(withPromotionNotificationDate({ ...form, notificationDate: "2026-09-20" }, "2026-09-28T15:00:00Z").notificationDate).toBe("2026-09-20");
  });
  it("leaves the line blank when there is no date at all", () => {
    expect(withPromotionNotificationDate(form, null).notificationDate).toBeUndefined();
    expect(notificationLine(buildPromotionFormBodyMarkup(form, "", {}))).toBe("&nbsp;");
  });
});
