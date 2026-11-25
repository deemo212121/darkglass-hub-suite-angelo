import { describe, expect, it } from "vitest";
import { parseCompletionText, planImport, type ImportContext } from "./branchCommissionImport";

const branches = new Map([
  ["norfolk", "Norfolk"],
  ["atlanta", "Atlanta"],
  ["huntsville", "Huntsville"],
  ["memphis", "Memphis"],
  ["capegirardeau", "Cape Girardeau"],
]);
const ctx: ImportContext = {
  branches,
  technicians: [
    { id: "el", name: "Edward Lindsey", branchKey: "norfolk" },
    { id: "kw", name: "Keion West", branchKey: "norfolk" },
    { id: "ts", name: "Ty Smith", branchKey: "huntsville" },
    { id: "ew", name: "Errin Williams", branchKey: "atlanta" },
    { id: "dh", name: "Deprece Harris", branchKey: "capegirardeau" },
    { id: "tm", name: "Tristin Mitchell", branchKey: "capegirardeau" },
    { id: "rs", name: "Rico Shaw", branchKey: "memphis" },
  ],
  managersOf: (k) => ({ norfolk: ["Chris Simpson"], huntsville: ["Jordan Stanley"], atlanta: ["Kevin Khaiphan"], memphis: ["Sean Smith"] } as Record<string, string[]>)[k] ?? [],
  paidKeys: new Set(),
};
const HEAD = ["Technician", "Home Location", "Role", "Week Start", "Week End", "Week", "Commission Branch", "LTP %", "Completion %", "Commission $", "Original Calculation", "Flash tech", "Damages", "total damage count on area", "review status", "Status"];

describe("parseCompletionText", () => {
  it("reads names and percents in the sheet's styles", () => {
    expect(parseCompletionText("Edward Lindsey- 57.7 %\nKeion West- 59.1 %")).toEqual([
      { name: "Edward Lindsey", pct: 57.7 },
      { name: "Keion West", pct: 59.1 },
    ]);
    expect(parseCompletionText('"JEff Lucas 38.9%\nRico Shaw 54.8%')).toEqual([
      { name: "JEff Lucas", pct: 38.9 },
      { name: "Rico Shaw", pct: 54.8 },
    ]);
  });
});

describe("planImport", () => {
  const rows = [
    HEAD,
    ["Chris Simpson", "Norfolk, VA", "BM", "9/27/2026", "10/3/2026", "W1", "Norfolk", 0.441, "Edward Lindsey- 66.7%\nKeion West- 66.7%", 240, "24*10 = 240", "No", "No", null, "Recorded", true],
    ["Erick Guzman", "Atlanta, GA", "BM", "9/27/2026", "10/3/2026", "W1", "Atlanta", null, null, null, "–", null, "No", null, "No amount entered", true],
    ["Jordan Stanley", "Huntsville, AL", "BM", "10/4/2026", "10/10/2026", "W2", "Huntsville", "70.68%", "Ty Smith 44.1%", 32.5, "70.68% 13*2.5", "No", "No", null, "Recorded", true],
    ["Kevin Khaiphan", "Atlanta, GA", "BM", "9/27/2026", "10/3/2026", "W1", "ATL", "60.7%", "Errin Williakms 74.4%", 530, "106*5 = 530", "No", "No", null, "Recorded", false],
    ["Matthew Nichols", "Memphis, TN", "BM CG", "9/27/2026", "10/3/2026", "W1", "Memphis / CG", "58.21%", "Deprece HArris 70%\nTristin Mitchell 60%", 60, "58.21% 14*5", "No", "No", null, "Confirm branch", true],
    ["Sean Smith", "Memphis, TN", "BM", "9/27/2026", "10/3/2026", "W1", "Memphis", "64.95%", "Rico Shaw 541.9%", 122.5, "64.95% 122.5", "No", "No", null, "Recorded", true],
  ];
  const lines = planImport([{ name: "Table1", rows }], ctx);
  const byRow = (r: number) => lines.find((l) => l.row === r)!;

  it("imports a clean line as ready", () => {
    const l = byRow(2);
    expect(l.state).toBe("ready");
    expect(l.periodStart).toBe("2026-09-27");
    expect(l.periodEnd).toBe("2026-10-03");
    expect(l.ltpPct).toBe(44.1);
    expect(l.tickets).toBe(24);
    expect(l.appAmount).toBe(240);
    expect(l.paid).toBe(true);
    expect(l.techs.map((t) => t.profileId)).toEqual(["el", "kw"]);
  });
  it("skips lines with no numbers", () => {
    expect(byRow(3).state).toBe("skipped");
  });
  it("flags when the app's $ differs from the sheet", () => {
    const l = byRow(4);
    expect(l.state).toBe("warning");
    expect(l.appAmount).toBe(0); // LTP over 70% is Condition 4 in the app
    expect(l.messages.join(" ")).toMatch(/sheet says \$32\.50/);
  });
  it("reads ATL as Atlanta and a near spelling as the tech", () => {
    const l = byRow(5);
    expect(l.branchKey).toBe("atlanta");
    expect(l.techs[0].profileId).toBe("ew");
    expect(l.paid).toBe(false);
  });
  it("sends Memphis / CG to the branch its techs are in", () => {
    expect(byRow(6).branchKey).toBe("capegirardeau");
    expect(byRow(6).state).not.toBe("error");
  });
  it("leaves out an impossible percent and works tickets out from the $", () => {
    const l = byRow(7);
    expect(l.branchKey).toBe("memphis");
    expect(l.techs).toHaveLength(0);
    expect(l.messages.join(" ")).toMatch(/541\.9% is over 100%/);
  });
});
