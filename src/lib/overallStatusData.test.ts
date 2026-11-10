import { describe, expect, it } from "vitest";
import { computeOverallStatus } from "./overallStatusData";
import type { Ticket } from "./ticketData";

const ticket = (ticketNo: string, created: string, ticketSource: string, status: string): Ticket =>
  ({ ticketNo, created, ticketSource, status, manufacturer: "", account: "", location: "Atlanta", technician: "", customer: "", cancellationReason: "" }) as unknown as Ticket;

const source = {
  tickets: [
    ticket("1", "2026-11-02", "GE", "OP-Ready for Service"),
    ticket("2", "2026-11-02", "GE", "CL-Completed"),
    ticket("3", "2026-11-03", "SQUARE TRADE", "OP-Ready for Service"),
    ticket("4", "2026-10-01", "GE", "OP-Ready for Service"),
  ],
  profiles: [],
};

describe("computeOverallStatus", () => {
  it("counts each source per day inside the date range only", () => {
    const data = computeOverallStatus(source, { startDate: "2026-11-01", endDate: "2026-11-10" });
    expect(data.dailyStats).toEqual([
      { date: "11/02", TOTAL: 2, GE: 2, "SQUARE TRADE": 0 },
      { date: "11/03", TOTAL: 1, GE: 0, "SQUARE TRADE": 1 },
    ]);
    expect(data.statLines.map((l) => l.key)).toEqual(["TOTAL", "GE", "SQUARE TRADE"]);
  });
  it("re-scopes from the same source when the range changes, without refetching", () => {
    expect(computeOverallStatus(source, { startDate: "2026-10-01", endDate: "2026-10-31" }).dailyStats).toEqual([{ date: "10/01", TOTAL: 1, GE: 1 }]);
  });
  it("keeps older still-open tickets in the pending snapshot", () => {
    const data = computeOverallStatus(source, { startDate: "2026-11-01", endDate: "2026-11-10" });
    expect(data.pendingByStatus).toEqual([expect.objectContaining({ name: "OP-Ready for Service", value: 3 })]);
  });
});
