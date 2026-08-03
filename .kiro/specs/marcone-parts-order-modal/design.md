# Design — Marcone Parts Order Modal

## Overview

This design replaces the silent **Submit PO / Submit All POs** flow on the Ticket Detail page with a Marcone-aware review modal. When at least one part on the Part Transaction grid has `partDist` matching a Marcone variant, the button opens a modal where the CSR confirms which parts to order, picks a Ship Method, selects (or types) a Ship-To address, and clicks **Place Order**. Only then does the system create the `part_orders` row, stamp PO Made + PO# back on the parts, and write audit entries. Non-Marcone parts continue through the existing silent submit path unchanged.

The modal is rendered from `MarconePartsOrderModal.tsx` (a new component under `src/components/`) and orchestrated by the existing `TicketDetailsPage` (`src/routes/ticket.$ticketNo.tsx`). All persistence calls reuse the helpers already in `src/lib/supabase/partOrders.ts` and `src/lib/supabase/tickets.ts`. The submission path is wrapped in a single async function (`placeMarconeOrder`) shaped to mirror Marcone's mSupply `POST /orders` payload so the real REST call is a one-file change later.

## Architecture

```
TicketDetailsPage (route)
  ├─ submitAllPOs()  ── splits parts ──► non-Marcone (silent path, existing)
  │                                  └─► Marcone parts ─► open modal
  ├─ submitPartPO(part)              └─► if Marcone ─► open modal
  │                                  └─► else      ─► silent path, existing
  └─ <MarconePartsOrderModal />
        ├─ props.parts          (Marcone-eligible PartTransactionRow[])
        ├─ props.ticket         (current Ticket — for PO# default, branch)
        ├─ props.branchAddress  (default Ship-To from Location Management)
        ├─ props.partAddresses  (PartAddressRow[] for the Address dropdown)
        └─ props.onPlaceOrder(payload) ─► placeMarconeOrder(payload)
                                              ├─ savePartOrder(orderRow)
                                              ├─ sbUpdateTicketPart(...) × N
                                              ├─ appendAuditEntry(...) × N
                                              └─ TODO: marconeRequest("POST /orders", payload)
```

Key decisions:

- **The modal owns its own form state** (selected parts, ship method, address overrides). When the user cancels, none of that leaks back to the ticket page.
- **Marcone detection lives in one helper** (`isMarconeDist`) so every entry point (per-row Submit, Submit All, future filters) uses the same matcher.
- **Persistence is decoupled from UI**. The modal hands a plain JSON `MarconeOrderPayload` to `placeMarconeOrder`; the route only knows how to refresh state after success.
- **Address autofill is bidirectional**: picking from the Address dropdown writes into the editable Ship-To fields, but editing any field does NOT clear the dropdown selection — we just stop overriding from it.


## Components and Interfaces

### `MarconePartsOrderModal` (new — `src/components/MarconePartsOrderModal.tsx`)

The modal itself. Portal-rendered to `document.body` at `z-50` to sit above the Ticket Detail sidebar (`z-20`) and existing modals.

```ts
export interface MarconePartsOrderModalProps {
  open: boolean;
  onClose: () => void;
  /** Marcone-eligible parts pre-selected. Already filtered upstream. */
  parts: PartTransactionRow[];
  ticketNo: string;
  /** Default Ship-To pulled from Location Management for the user's branch. */
  defaultShipTo: ShipToAddress;
  /** Address dropdown options. Includes branch + every PartAddressRow. */
  addressBook: AddressBookEntry[];
  /** Default CSR/branch email for the recipient. */
  defaultEmail: string;
  /** Default branch phone. */
  defaultPhone: string;
  /** Called when the user clicks Place Order with a validated payload. */
  onPlaceOrder: (payload: MarconeOrderPayload) => Promise<void>;
}
```

State the modal holds:

```ts
type LineState = {
  partId: string;          // PartTransactionRow.id (used to write back later)
  selected: boolean;       // checkbox tick state
  partNo: string;
  partDesc: string;
  partPrice: number;
  coreValue: number;
  orderQty: number;        // editable, defaults to row.quantity (≥ 1)
};

type ShipToAddress = {
  name: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
};
```


### `AddressBookEntry`

A flat, presentation-friendly entry the dropdown can render:

```ts
type AddressBookEntry = {
  id: string;        // "branch:Memphis", "part:<uuid>", etc.
  label: string;     // shown in <option>; e.g. "Memphis — 3663 Cherry Rd #101"
  shipTo: ShipToAddress;
};
```

The modal's host (`TicketDetailsPage`) builds this list once: branch entry first, then every `PartAddressRow` returned by `getPartAddresses()`. The host owns this fetch so we don't refire it every time the modal mounts.

### `MarconeOrderPayload`

Shaped to mirror Marcone's mSupply `POST /orders` body so the future REST swap is mechanical:

```ts
export interface MarconeOrderPayload {
  /** Ticket number for traceability. NOT part of Marcone's body, but we
   * keep it on the payload because savePartOrder needs it. */
  ticketNo: string;
  purchaseOrderNumber: string;     // PO No*
  shipMethod: string;              // Ground | 2-Day | Overnight | Will Call
  shipTo: ShipToAddress;
  lineItems: Array<{
    partId: string;                // local row id — used by the writer
    partNumber: string;            // Marcone field
    description: string;
    quantity: number;
    unitPrice: number;
    coreValue: number;
  }>;
}
```

### `placeMarconeOrder` (new — added to `src/lib/supabase/partOrders.ts`)

```ts
export async function placeMarconeOrder(payload: MarconeOrderPayload): Promise<{
  poNo: string;
  affectedPartIds: string[];
}>;
```

Pseudocode:

```
1.  generate poNo if not provided (reuse existing generatePoNumber)
2.  build a single StoredPartOrder summarizing the order
    (partNo + partDesc list joined; quantity = sum, partPrice = total)
3.  await savePartOrder(order)
4.  for each line in payload.lineItems:
       await sbUpdateTicketPart(line.partId, {
         status: 'PO Made',
         poNo: payload.purchaseOrderNumber,
         poDate: today,
       })
5.  // TODO: Marcone real call
    //   await marconeRequest('POST', '/orders', { body: payload })
6.  return { poNo, affectedPartIds: payload.lineItems.map(l => l.partId) }
```

If step 4 throws partway through, we attempt `deletePartOrder(poNo)` to keep the system consistent and re-throw so the modal can keep its state and show the error.


### `isMarconeDist(value: string): boolean`

```ts
export function isMarconeDist(value: string): boolean {
  return /\bmarcone\b/i.test(value || "");
}
```

Lives alongside the existing constants in `src/lib/supabase/partOrders.ts` and is imported by both the route and the modal so detection stays consistent.

### Changes to `TicketDetailsPage` (`src/routes/ticket.$ticketNo.tsx`)

Three additions:

1. **State** — `marconeModal: { open: boolean; parts: PartTransactionRow[] } | null`. Plus an `addressBook` state hydrated once on mount via `getPartAddresses()`.
2. **Route helpers** — refactor the existing `submitPartPO` and `submitAllPOs` to split parts by `isMarconeDist`. Non-Marcone parts continue down the existing silent path; Marcone parts trigger `setMarconeModal({ open: true, parts: marconeParts })`.
3. **Modal mount** — `<MarconePartsOrderModal />` rendered conditionally at the bottom of the page's JSX, wired to:
   - `onClose` → `setMarconeModal(null)`
   - `onPlaceOrder` → `await placeMarconeOrder(payload)`; then reload the part rows from Supabase (`sbGetTicketParts`) and close.

The existing `submitAllPOs` confirmation alert (`Submit N PO(s)…`) is removed for the Marcone path since the modal IS the confirmation. The non-Marcone branch keeps its existing `confirm()`.

## Data Models

No schema changes. The modal reuses three existing tables:

| Table | Purpose |
|---|---|
| `parts` | Source rows for the modal's parts list; updated with `status='PO Made'` + `po_no` on success. |
| `part_orders` | One row inserted per modal submission (single PO per submit per ticket — see Requirement 4.1). |
| `location_mgmt_part_addresses` | Address dropdown options. |

`StoredPartOrder.partNo` / `partDesc` / `partPrice` / `quantity` already represent a single "summary" row. For multi-line orders we'll write the same summary shape that the existing `submitAllPOs` writes (one row per PO, partNo = comma-joined of selected lines, quantity = sum, partPrice = total). This keeps backward compatibility with the Part Order page.

Future enhancement: a `part_order_lines` child table for true line items. Out of scope for v1 — flagged in requirements.

## Error Handling

| Scenario | Behavior |
|---|---|
| Modal opens with zero Marcone parts | `submitAllPOs` short-circuits before opening; `submitPartPO` uses the silent path. |
| User unticks every row | Place Order button disabled with title "Select at least one part". |
| User leaves a required field blank (PO No, Ship Method, Ship To Name, Street 1, City, State, ZIP) | Place Order button disabled with tooltip listing missing fields. Fields with missing values get a rose border (`border-rose-500/50`) once the user has attempted to submit. |
| `savePartOrder` throws | Show inline error banner inside the modal (`bg-rose-500/10 border-rose-500/30 text-rose-300`). Do not close. Do not flip any part statuses. |
| `sbUpdateTicketPart` throws mid-loop | Attempt `deletePartOrder(poNo)` to undo the PO row, surface error in the modal banner, keep modal open. |
| Network offline | Same as a thrown error — surfaced as "Could not reach the server. Please retry." |
| User presses Escape | Modal closes without saving. State is discarded. |
| User clicks the backdrop | No-op (fat-finger guard per Requirement 5.3). |
| Ticket lock (`partsEditDisabled === true`) | Submit buttons stay disabled; modal never opens. |


## UI / Visual Spec

Top-level structure:

```
<div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
  <div className="w-full max-w-5xl rounded-md bg-slate-950 ring-1 ring-white/10 shadow-xl flex flex-col max-h-[90vh]">

    {/* Header bar — Marcone blue */}
    <div className="bg-[#1f7cf3] text-white px-4 py-2 flex items-center justify-between rounded-t-md">
      <span className="font-semibold">Marcone Parts Order</span>
      <button aria-label="Close" onClick={onClose}>✕</button>
    </div>

    {/* Parts table */}
    <div className="overflow-auto px-4 py-3 border-b border-white/10">
      <table className="w-full text-sm">
        <thead className="bg-slate-800/60 text-slate-300">
          <tr>
            <th>Ticket #</th><th>Select</th><th>Part No</th>
            <th>Description</th><th>Price</th><th>Core Value</th><th>Order Qty</th>
          </tr>
        </thead>
        <tbody>… one row per line …</tbody>
      </table>
    </div>

    {/* Pagination strip — visual parity */}
    <div className="px-4 py-1 flex items-center justify-between text-xs">
      <span className="space-x-3">
        <button className="text-blue-300 underline">10</button> 20 50 100 500
      </span>
      <span className="bg-blue-500 text-white px-2 rounded">1</span>
    </div>

    {/* Address form — 2-col grid */}
    <div className="px-4 py-3 grid grid-cols-[80px_1fr_80px_1fr] gap-x-3 gap-y-2 text-sm">
      … PO No, Ship Method, Address dropdown, Ship To Name,
        Ship To (5 inputs spanning), Phone, Email …
    </div>

    {/* Footer actions */}
    <div className="px-4 py-3 border-t border-white/10 flex justify-end gap-2">
      <button onClick={onClose}>Cancel</button>
      <button onClick={handlePlace} disabled={!canPlace}>Place Order</button>
    </div>
  </div>
</div>
```

Notable styling rules:

- Header bar uses Marcone blue `#1f7cf3` (per the legacy screenshot). White close icon top-right.
- The parts table rows alternate `bg-slate-900/40` and `bg-slate-900/20`. Selected rows get a `ring-1 ring-blue-400/30` accent so the user can see which ones are about to be ordered.
- The pagination strip is decorative for v1 — visible because the user asked for parity with the legacy modal, but the underlying state is just `pageSize` (number) wired to nothing since most tickets have ≤ 10 parts. We'll wire real pagination when (if) someone hits the edge case of 100+ parts on one ticket.
- The Address dropdown uses a custom `<select>` whose options are `addressBook[]`. The label format is `${name} — ${street1}` so it's scannable.
- The 5-cell `Ship To` row uses CSS `grid-template-columns: 1fr 1fr 1fr 80px 100px` so State and ZIP stay narrow while the street + city expand.
- The Phone field uses `inputMode="tel"` for mobile keypad. Email uses `type="email"` so browser validation kicks in.

## Testing Strategy

Type-checking is the primary signal; this file has no current test runner wired in. Manual smoke flows the reviewer should walk through after implementation:

1. **Open ticket with all-Marcone parts → Submit All POs**. Modal opens with every part pre-selected. Confirm Place Order writes one `part_orders` row, every part flips to `PO Made`, audit log shows "Submitted PO (Marcone Modal)" entries.
2. **Per-row Submit on a Marcone part**. Modal opens with that one part. Untick it. Place Order should be disabled.
3. **Mixed ticket (Marcone + Encompass parts) → Submit All POs**. Encompass parts go through silent path; Marcone parts open the modal; both end states reconcile cleanly on the grid.
4. **Address dropdown auto-fill**. Pick "Memphis" → fields populate. Edit Street manually. Place Order persists the edited fields, not the original branch address.
5. **Validation gates**. Clear Ship Method, try to click Place Order. Button disabled, tooltip lists missing fields.
6. **Cancel paths**. Click ✕ → closes, nothing saved. Press Escape → same. Click black backdrop → nothing happens.
7. **Locked ticket** (`partsEditDisabled === true`). Submit PO / Submit All POs buttons are disabled; modal never opens.
8. **Error rollback**. Simulate a Supabase failure on `sbUpdateTicketPart` (e.g. by editing a part's row id in dev tools) → confirm the PO row is deleted and the modal stays open with the error banner.

## Migration / Rollout

No schema migration required. The change is pure client + helper additions:

| File | Change |
|---|---|
| `src/components/MarconePartsOrderModal.tsx` | NEW component |
| `src/lib/supabase/partOrders.ts` | Add `isMarconeDist`, `MarconeOrderPayload`, `placeMarconeOrder` |
| `src/routes/ticket.$ticketNo.tsx` | Split submit flows; mount the modal; load address book on mount |

Roll-out is a single deploy. No feature flag — the modal only activates for Marcone parts, which is a strict subset of today's flow, so the blast radius is contained.


## Correctness Properties

These invariants are what reviewers / future-me should be able to verify by reading the implementation.

### Property 1: No silent side effects on open

Mounting `MarconePartsOrderModal` MUST NOT touch Supabase, `part_orders`, or any audit log. Side effects fire only inside `handlePlace`.

**Validates: Requirements 1.5, 5.4**

### Property 2: Single PO per submit

Every `Place Order` click writes exactly one row to `part_orders`. Multiple clicks during a single open session are guarded by an `isPlacing` state so we can't double-submit.

**Validates: Requirements 4.1, 4.2**

### Property 3: Status flip is atomic-ish

If any `sbUpdateTicketPart` call inside `placeMarconeOrder` throws, the PO row inserted in step 3 is rolled back via `deletePartOrder` (best-effort). The modal MUST remain open with state preserved so the user can retry.

**Validates: Requirements 4.5**

### Property 4: Detection consistency

Every entry point (per-row Submit, Submit All, future filter buttons) calls `isMarconeDist(part.partDist)` — no inline string matching anywhere else. Adding a new Marcone variant means editing one regex.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4**

### Property 5: Lock honors partsEditDisabled

The modal MUST be unreachable when `partsEditDisabled === true`. The Submit buttons are already disabled in that case; the route handler should also early-return defensively.

**Validates: Requirements 7.1, 7.2**

### Property 6: Re-entrancy on success

After `placeMarconeOrder` resolves, the host reloads `partRows` from Supabase rather than mutating local state in place. This guarantees the grid reflects the canonical DB state even if another tab changed something concurrently.

**Validates: Requirements 4.4**

### Property 7: Address autofill is one-way

Selecting an `AddressBookEntry` overwrites the form fields. Editing any field after that DOES NOT clear the dropdown's currently-displayed selection — the dropdown just becomes a hint, not a binding. Re-selecting the same entry overwrites again.

**Validates: Requirements 3.4, 3.6, 8.3**

### Property 8: Payload shape stability

`MarconeOrderPayload.shipTo` and `MarconeOrderPayload.lineItems[]` shapes match what Marcone's documented mSupply `POST /orders` expects so the future REST swap is a string replacement, not a refactor.

**Validates: Requirements 6.1, 6.2, 6.3**
