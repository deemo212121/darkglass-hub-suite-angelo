import { beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the one table these functions touch.
const db = vi.hoisted(() => ({ row: null as any, updates: [] as any[], filters: [] as any[] }));

vi.mock("./client", () => {
  const query = () => {
    const q: any = {
      _update: null as any,
      _filters: [] as [string, unknown][],
      select() { return q; },
      update(patch: any) { q._update = patch; return q; },
      eq(col: string, val: unknown) { q._filters.push([col, val]); return q; },
      async maybeSingle() { return { data: db.row, error: null }; },
      then(ok: any, bad: any) {
        // An update: applies only if every filter matches the stored row.
        const matches = db.row && q._filters.every(([c, v]: [string, unknown]) => db.row[c] === v);
        db.updates.push(q._update);
        db.filters.push(q._filters);
        if (matches) Object.assign(db.row, q._update);
        return Promise.resolve({ data: matches ? [{ id: db.row.id }] : [], error: null }).then(ok, bad);
      },
    };
    return q;
  };
  return { supabase: { from: () => query() } };
});
vi.mock("@/lib/appErrorLog", () => ({ logAppError: vi.fn() }));
vi.mock("./csrAgentNotes", () => ({ deleteAgentNote: vi.fn(async () => undefined) }));
vi.mock("./technicianFormExemptions", () => ({ getTechnicianFormExemptions: vi.fn() }));
vi.mock("./users", () => ({ setProfileFrozen: vi.fn() }));
vi.mock("@/lib/completedPapers", () => ({ isCompletedPaper: () => false }));
vi.mock("@/lib/formConsistency", () => ({ checksIdentityFields: () => false, documentOwner: () => null }));

import { statusBeforeCancel, undoCancelOutcome, undoCancelSignableDocument, type SignableDocument } from "./signableDocuments";

const row = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  company_id: "c1",
  document_type: "warning_form",
  form_data: { employeeName: "Tom Tech", recipientName: "Maria Manager" },
  signatures: {},
  status: "cancelled",
  recipient_id: "p-maria",
  recipient_name: null,
  recipient_slot: "manager",
  pdf_url: null,
  agent_note_id: null,
  created_by: "p-hr",
  created_at: "2026-11-01T00:00:00Z",
  signed_at: null,
  confirmed_at: null,
  cancelled_at: "2026-11-05T00:00:00Z",
  ...over,
});
const doc = (over: Partial<SignableDocument> = {}) =>
  ({ confirmedAt: null, signatures: {}, recipientSlot: "manager", recipientName: null, formData: { recipientName: "Maria Manager" }, ...over }) as SignableDocument;

beforeEach(() => {
  db.row = null;
  db.updates = [];
  db.filters = [];
});

describe("statusBeforeCancel", () => {
  it("confirmed if it had been confirmed", () => {
    expect(statusBeforeCancel(doc({ confirmedAt: "2026-11-02T00:00:00Z", signatures: { employee: {} } as any }))).toBe("confirmed");
  });
  it("signed if its current signer had signed", () => {
    expect(statusBeforeCancel(doc({ signatures: { manager: { name: "Maria" } } as any }))).toBe("signed");
  });
  it("waiting if sent on to a signer who hadn't signed yet (an earlier signer's signature doesn't count)", () => {
    expect(statusBeforeCancel(doc({ signatures: { employee: { name: "Tom" } } as any, recipientSlot: "manager" }))).toBe("pending_signature");
  });
  it("waiting if nobody had signed", () => {
    expect(statusBeforeCancel(doc())).toBe("pending_signature");
  });
});

describe("undoCancelOutcome", () => {
  it("names the signer it goes back to", () => {
    expect(undoCancelOutcome(doc())).toBe("back to waiting for Maria Manager to sign — the link they were sent works again");
    expect(undoCancelOutcome(doc({ formData: {}, recipientName: "Outside Person" } as any))).toContain("Outside Person");
    expect(undoCancelOutcome(doc({ signatures: { manager: {} } as any }))).toBe("back to signed, waiting for you to confirm it");
    expect(undoCancelOutcome(doc({ confirmedAt: "2026-11-02T00:00:00Z" }))).toBe("back to confirmed");
  });
});

describe("undoCancelSignableDocument", () => {
  it("puts a cancelled form back to waiting for its signer", async () => {
    db.row = row();
    await expect(undoCancelSignableDocument("d1")).resolves.toBe("pending_signature");
    expect(db.row).toMatchObject({ status: "pending_signature", cancelled_at: null, agent_note_id: null });
  });
  it("puts a reverted warning back to confirmed, with its new record entry", async () => {
    db.row = row({ confirmed_at: "2026-11-02T00:00:00Z", signatures: { employee: {}, manager: {} } });
    await expect(undoCancelSignableDocument("d1", "note-2")).resolves.toBe("confirmed");
    expect(db.row).toMatchObject({ status: "confirmed", agent_note_id: "note-2", cancelled_at: null });
  });
  it("only touches a form that's still cancelled", async () => {
    db.row = row();
    await undoCancelSignableDocument("d1");
    expect(db.filters[0]).toEqual([["id", "d1"], ["status", "cancelled"]]);
  });
  it("refuses a form that isn't cancelled anymore", async () => {
    db.row = row({ status: "pending_signature" });
    await expect(undoCancelSignableDocument("d1")).rejects.toThrow(/isn't cancelled anymore/);
    expect(db.updates).toEqual([]);
  });
  it("says so when nothing changed (someone else got there first, or no permission)", async () => {
    db.row = row();
    const original = db.row;
    // Another person undoes it between our read and our write.
    let reads = 0;
    Object.defineProperty(db, "row", { configurable: true, get: () => (reads++ === 0 ? original : { ...original, status: "pending_signature" }), set: () => {} });
    try {
      await expect(undoCancelSignableDocument("d1")).rejects.toThrow(/Couldn't undo/);
    } finally {
      Object.defineProperty(db, "row", { value: null, writable: true, configurable: true, enumerable: true });
    }
  });
  it("a form that's gone", async () => {
    db.row = null;
    await expect(undoCancelSignableDocument("d1")).rejects.toThrow(/not found/);
  });
});

describe("undoConfirmSignableDocument", () => {
  it("puts a confirmed warning back to awaiting signature and takes it off the record", async () => {
    const { undoConfirmSignableDocument } = await import("./signableDocuments");
    const { deleteAgentNote } = await import("./csrAgentNotes");
    db.row = row({ status: "confirmed", confirmed_at: "2026-11-09T00:00:00Z", agent_note_id: "note-1", cancelled_at: null });
    await undoConfirmSignableDocument("d1");
    expect(db.row).toMatchObject({ status: "pending_signature", confirmed_at: null, agent_note_id: null });
    expect(db.filters[0]).toEqual([["id", "d1"], ["status", "confirmed"]]);
    expect(deleteAgentNote).toHaveBeenCalledWith("note-1");
  });
  it("refuses a form that isn't confirmed anymore, and leaves the record alone", async () => {
    const { undoConfirmSignableDocument } = await import("./signableDocuments");
    const { deleteAgentNote } = await import("./csrAgentNotes");
    (deleteAgentNote as any).mockClear();
    db.row = row({ status: "pending_signature", agent_note_id: "note-1" });
    await expect(undoConfirmSignableDocument("d1")).rejects.toThrow(/isn't confirmed anymore/);
    expect(db.updates).toEqual([]);
    expect(deleteAgentNote).not.toHaveBeenCalled();
  });
});
