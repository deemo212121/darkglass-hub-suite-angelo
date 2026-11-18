import { describe, expect, it } from "vitest";
import { getDocumentReviewStatus, pickAuthoritativeDocument } from "./signableDocumentRegistry";
import type { SignableDocumentStatus } from "./supabase/signableDocuments";

const doc = (id: string, status: SignableDocumentStatus, createdAt: string, recipientSlot = "employee") => ({ id, status, createdAt, recipientSlot, documentType: "i9", formData: {} });

describe("which copy of a form counts when there are several", () => {
  it("a copy the employee signed (with HR now) beats a newer unsigned duplicate", () => {
    // Daven Hodge's I-9: signed 08/24 and parked with HR for Section 2, then resent unsigned on 08/26.
    const signed = doc("signed", "pending_signature", "2026-08-24T23:18:00Z", "hr_staff");
    const resent = doc("resent", "pending_signature", "2026-08-26T12:32:00Z", "employee");
    const best = pickAuthoritativeDocument([signed, resent])!;
    expect(best.id).toBe("signed");
    expect(getDocumentReviewStatus("i9", best)).toBe("awaiting_hr");
  });

  it("a fully signed or confirmed copy still beats one with HR", () => {
    expect(pickAuthoritativeDocument([doc("hr", "pending_signature", "2026-09-02T00:00:00Z", "hr_staff"), doc("done", "confirmed", "2026-09-01T00:00:00Z")])!.id).toBe("done");
    expect(pickAuthoritativeDocument([doc("hr", "pending_signature", "2026-09-02T00:00:00Z", "hr_staff"), doc("signed", "signed", "2026-09-01T00:00:00Z")])!.id).toBe("signed");
  });

  it("two copies both waiting on the employee: the newer one", () => {
    expect(pickAuthoritativeDocument([doc("old", "pending_signature", "2026-08-01T00:00:00Z"), doc("new", "pending_signature", "2026-08-02T00:00:00Z")])!.id).toBe("new");
  });

  it("a cancelled copy never wins over a live one", () => {
    expect(pickAuthoritativeDocument([doc("live", "pending_signature", "2026-08-01T00:00:00Z"), doc("gone", "cancelled", "2026-08-05T00:00:00Z")])!.id).toBe("live");
  });
});
