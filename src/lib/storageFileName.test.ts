import { describe, expect, it } from "vitest";
import { storageFileName } from "./storageFileName";

describe("storageFileName", () => {
  it("drops accents so Storage accepts the key", () => {
    expect(storageFileName("José-Walss-resume.pdf")).toBe("Jose-Walss-resume.pdf");
    expect(storageFileName("Peña Ñúñez CV.docx")).toBe("Pena Nunez CV.docx");
  });
  it("keeps ordinary names as they are", () => {
    expect(storageFileName("John Smith (2) resume_v3.pdf")).toBe("John Smith (2) resume_v3.pdf");
  });
  it("replaces anything else Storage can't take", () => {
    expect(storageFileName("résumé #1 – final?.pdf")).toBe("resume _1 _ final_.pdf");
    expect(storageFileName("履歴書.pdf")).toBe("_.pdf");
    expect(storageFileName("a/b\\c.pdf")).toBe("a_b_c.pdf");
  });
  it("never comes back empty", () => {
    expect(storageFileName("")).toBe("file");
  });
});
