# Requirements — Marcone Parts Order Modal (Submit PO flow)

## Introduction

Today the Part Transaction table's **Submit All POs** button silently iterates every part that has no PO number, generates an internal PO number, writes a row into `part_orders`, flips the part's status to "PO Made", and shows an alert. No preview, no per-part selection, no ship method, no ship-to address — the CSR has no chance to review or correct the order before it's "submitted".

This feature replaces that silent flow with a proper **Marcone Parts Order modal** (matching the existing legacy USAPP design the user shared) that:

- Opens when the CSR clicks Submit PO / Submit All POs on a Part Transaction whose **Part Dist.** is Marcone (or any Marcone variant).
- Shows every Marcone-eligible part for the ticket as a checkbox list with Part No, Description, Price, Core Value, and Order Qty.
- Lets the CSR confirm a PO No, pick a Ship Method, pick a Ship-To Address (with one-click "use my branch" entries from Location Management), tweak the address inline, and confirm the recipient name / phone / email.
- Only when the user clicks **Place Order** does the system actually create the `part_orders` row, flip the part statuses to "PO Made", and stamp the PO numbers back onto the part rows.

For other distributors (Encompass, NSA, GE, etc.) the existing silent submit flow stays as-is — this modal is **Marcone-specific**. We can layer in other distributor modals later but they're out of scope for v1.

## Requirements

### Requirement 1 — Modal opens for Marcone parts

**User Story:** As a CSR, when I click Submit PO on a part whose Part Dist. is Marcone, I want to be taken into a review modal instead of an immediate silent submit, so I can confirm the order before anything gets written.

#### Acceptance Criteria

1. WHEN the user clicks the per-row "Submit PO" button on a Part Transaction whose `partDist` matches a Marcone variant (case-insensitive: `Marcone`, `Marcone-162468`, `Marcone- Birmingham / Montgomery`, or any other label starting with `Marcone`) THEN the system SHALL open the **Marcone Parts Order** modal pre-populated with that single part pre-selected.
2. WHEN the user clicks the global "Submit All POs" button AND at least one part in the table has a Marcone `partDist` AND no `poNo` yet THEN the system SHALL open the **Marcone Parts Order** modal pre-populated with every eligible Marcone part pre-selected.
3. WHEN the user clicks "Submit All POs" AND no Marcone parts need a PO (but other distributors do) THEN the system SHALL fall back to the existing silent submit flow for those non-Marcone parts and SHALL NOT open the Marcone modal.
4. WHEN the user clicks "Submit All POs" AND the table contains a mix of Marcone + non-Marcone parts THEN the modal SHALL open for the Marcone parts only, and the non-Marcone parts SHALL be submitted silently through the existing path either before or after the modal closes (whichever the implementation finds simpler; this MUST NOT block Marcone review on non-Marcone failures).
5. WHEN the modal opens THEN the system SHALL NOT create or modify any `part_orders` rows, MUST NOT flip part statuses, and MUST NOT append an audit entry — those side effects happen only after the user confirms inside the modal.

### Requirement 2 — Parts list table

**User Story:** As a CSR, I want to see every Marcone part the system is about to order in a single scrollable list with a checkbox per row, so I can deselect any part that shouldn't be on this PO.

#### Acceptance Criteria

1. The modal SHALL show a table with columns (left-to-right): **Ticket #**, **Select** (checkbox), **Part No**, **Description**, **Price**, **Core Value**, **Order Qty**.
2. The Ticket # column SHALL show the current ticket number on every row (this matches the legacy modal layout the user shared and supports multi-ticket POs later).
3. The Select checkbox SHALL default to ticked for every part the modal was opened with.
4. The user SHALL be able to tick/untick individual parts. At least one row must remain ticked for the **Place Order** button to be enabled.
5. The Price and Core Value SHALL display as `$X.XX` with two decimals. Empty values SHALL render as `$0.00`.
6. The Order Qty cell SHALL be editable inline (`type="number"`, min=1) so the CSR can bump a quantity before placing the order.
7. The table SHALL include footer pagination ("10 20 50 100 500") matching the legacy design — even though most tickets have few parts, this keeps visual parity with the existing app.

### Requirement 3 — Order header form

**User Story:** As a CSR, I want to confirm the PO number, ship method, and ship-to address before placing the order, so the warehouse sends the parts to the right place.

#### Acceptance Criteria

1. Below the parts table the modal SHALL show a form with these fields, all rendered as a 2-column grid like the screenshot: **PO No\***, **Ship Method\***, **Address**, **Ship To Name\***, **Ship To** (Street, Street 2, City, State, ZIP), **Phone #**, **Email Address**.
2. **PO No** SHALL default to the ticket number (e.g. `26000886347DF`) and stay editable. Asterisk indicates required.
3. **Ship Method** SHALL be a `<select>` populated with at least: `Ground`, `2-Day`, `Overnight`, `Will Call`. Required.
4. **Address** SHALL be a `<select>` of pre-saved addresses. The list SHALL include every entry from the Part Pickup Addresses (`part_addresses` table / `LocationManagementPage`) plus the user's assigned branch. Picking an entry SHALL auto-fill **Ship To Name**, **Ship To**, **Phone #**, and **Email Address** below it.
5. **Ship To Name** SHALL be required and default to the assigned branch's name (e.g. `Jackson,TN`).
6. **Ship To** SHALL be five separate inputs in one row: Street 1, Street 2, City, State, ZIP — all editable so the CSR can override an address that doesn't quite match.
7. **Phone #** SHALL default to the branch phone (e.g. `8007793579`) and stay editable.
8. **Email Address** SHALL default to the CSR's email or the branch contact email and stay editable.
9. WHEN any required field (PO No, Ship Method, Ship To Name, Street 1, City, State, ZIP) is blank THEN the **Place Order** button SHALL be disabled with a tooltip listing the missing fields.

### Requirement 4 — Placing the order

**User Story:** As a CSR, when I click Place Order in the modal, I want every ticked part to be saved as a single PO with the address info I confirmed, and the modal to close cleanly.

#### Acceptance Criteria

1. WHEN the user clicks **Place Order** AND all required fields are valid THEN the system SHALL create one `part_orders` row containing the ticked parts, the PO No, ship method, ship address, recipient name, phone, and email.
2. WHEN the order is saved THEN every ticked part on the ticket SHALL have its `poNo`, `poDate`, and `status: "PO Made"` written back to the `parts` row (via `sbUpdateTicketPart`) so the Part Transaction grid reflects the new state immediately.
3. WHEN the save succeeds THEN the system SHALL append an audit entry per ticked part with action `"Submitted PO (Marcone Modal)"`, the part number, the new PO No, and the chosen ship method.
4. WHEN the save succeeds THEN the modal SHALL close, show a brief success toast/alert (`PO {poNo} created — N parts`), and refresh the Part Transaction grid.
5. WHEN any individual part update fails THEN the system SHALL roll back the PO row (best-effort: delete the just-inserted `part_orders` row) and surface a clear error so the user can retry; the modal SHALL stay open with its state intact.
6. The legacy generic "Submit All POs" silent path SHALL still write internal POs for non-Marcone distributors using the existing `createPartOrderFromTicket` + `savePartOrder` helpers; nothing about that pathway changes.

### Requirement 5 — Modal close + cancel

**User Story:** As a CSR, I want to be able to back out of the modal without making any changes if I realize the parts aren't ready, so I don't get stuck.

#### Acceptance Criteria

1. The modal header SHALL render a Marcone-blue title bar reading **Marcone Parts Order** with an `×` close icon on the right (matching the legacy design).
2. Clicking the `×` close button OR pressing `Escape` SHALL close the modal without saving anything.
3. Clicking the dark backdrop outside the modal panel SHALL NOT close it (we want explicit user intent — fat-finger guard for big tables).
4. When the modal is closed without saving, the underlying Part Transaction grid SHALL be unchanged (same `poNo`, same statuses, same audit log).

### Requirement 6 — Marcone API readiness (forward-compatible)

**User Story:** As a developer, I want the modal's submission path to be wired so we can later swap the local "save to part_orders" with a real Marcone order POST without rewriting UI.

#### Acceptance Criteria

1. The submission handler SHALL be a single async function (e.g. `placeMarconeOrder(payload)`) that receives a structured payload (parts array + ship details) — the UI MUST NOT inline the persistence logic, so we can later route through Marcone's REST API.
2. The payload SHALL be shaped to mirror what Marcone's `POST /orders` endpoint expects in their documented mSupply API: `{ purchaseOrderNumber, shipMethod, shipTo: { name, street1, street2, city, state, zip, phone, email }, lineItems: [{ partNumber, quantity, unitPrice }] }`.
3. For v1 the handler SHALL persist to local Supabase (`part_orders`) as today. The Marcone REST call SHALL be a TODO comment in the handler so it's a single-file change later.

### Requirement 7 — Permissions and lock behavior unchanged

**User Story:** As a manager, I don't want CSRs bypassing the Claims-only lock on Completed / Claimed tickets just because the Marcone modal exists.

#### Acceptance Criteria

1. The Submit PO and Submit All POs buttons SHALL remain disabled (existing `partsEditDisabled` logic) for tickets in Claimed / Data Closed status for non-Claims users.
2. The Marcone modal SHALL NEVER open when those buttons are disabled.
3. The existing `notifyUnauthorizedPartEdit` notification SHALL still fire for unauthorized part edits — the modal change doesn't widen the attack surface for locked tickets.

### Requirement 8 — Visual parity with the legacy modal

**User Story:** As a CSR who used the previous USAPP system, I want the modal to feel familiar so I don't have to retrain.

#### Acceptance Criteria

1. The header bar SHALL be solid Marcone blue with white text.
2. The parts list SHALL use white-on-light striped rows.
3. The address form SHALL use a 2-column grid with `Ship To` spanning the full row across 5 input cells (Street, Street 2, City, State, ZIP) just like the screenshot.
4. The pagination row SHALL render `10  20  50  100  500` left-justified with the active page count highlighted, and a `1` page indicator right-aligned.
5. The modal SHALL be wide (≥ `max-w-5xl`) so the parts list and address form fit comfortably without horizontal scroll on a 1280px screen.

## Out of scope (for this spec)

- Real Marcone REST API integration (`POST /orders`). Wiring `placeMarconeOrder` to actually hit Marcone is its own future spec; for now it persists locally.
- Mirror modals for non-Marcone distributors (Encompass, NSA, GE, LG, Squaretrade, etc.). They keep the existing silent flow.
- Address-book CRUD inside the modal (creating brand-new Ship-To addresses on the fly). The dropdown reuses what's already in Location Management's Part Pickup Addresses; new entries are still added through that page.
- Order tracking after submission (tracking numbers, ETAs). This is the **place order** step only — the tracking columns on the Part Transaction grid (`In Tracking #`, `ETA`, etc.) are still filled in later.
- Multi-ticket POs (sending one Marcone order across many tickets at once). The Ticket # column is in the table for future-proofing, but v1 only processes the current ticket.
- A separate "saved orders" page or order history view; the existing Part Order page already serves this purpose.
