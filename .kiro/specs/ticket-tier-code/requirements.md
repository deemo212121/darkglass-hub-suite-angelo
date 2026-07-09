# Requirements Document

## Introduction

The ticket-detail page (`/ticket/:ticketNo`) currently displays a row of summary "pills" at the top — `Account • Warranty • Status • Product • TAT • Schedule • Contact` — and a labeled `General Information` section below it. For three specific warranty companies (Assurant, GE Appliances, and Miele) the back-office team needs to see a per-claim **Tier Code** that determines the labor rate for the job. The tier is looked up from the customer's ZIP code against a warranty-specific rate sheet provided in the *Home Services Claim Rules* workbook.

This feature adds:

1. A warranty-aware tier lookup module that resolves a customer ZIP to a tier code for Assurant, GE, and Miele tickets.
2. A `Tier` slot in the ticket header pill row, replacing the existing `Contact` slot, that shows the resolved tier code for tickets from those three warranties.
3. A `Tier Code` row in the `General Information` section showing the same value with its rate.

Tickets from any other warranty (Square Trade, AIG, NSA, SPPN, LG, Samsung, Frigidaire, Centricity, In-Warranty, OOW, etc.) MUST NOT show a tier code anywhere on the page.

## Glossary

- **Ticket_Detail_Page**: The route component at `src/routes/ticket.$ticketNo.tsx` that renders a single ticket.
- **Header_Pill_Row**: The single-line summary directly under the `Ticket #<n>` heading on the Ticket_Detail_Page that today shows `Account • Warranty • Status • Product • TAT • Schedule • Contact`.
- **General_Information_Section**: The section on the Ticket_Detail_Page rendered under the `General Information` heading (when the `general` tab is active).
- **Tier_Lookup_Module**: A new TypeScript module (proposed path `src/lib/tierCodes.ts`) that, given a warranty identifier and a ZIP code, returns the tier code, the labor rate, and any sub-codes for that warranty.
- **Tier_Code**: A short identifier for the labor-rate tier that applies to a claim. Format varies by warranty:
  - GE: a labor job code (`MA00`, `MA01`, `MA02`, `MA03`, `MG00`, `SG00`) and/or a seal-system code (`SS00`, `SS01`, `SS02`).
  - Assurant: a repair-code tier with three rate variants per tier — `T200/T202/T203`, `T300/T302/T303`, `T400/T402/T403`.
  - Miele: one of `Base Rate`, `Tier 1`, `Tier 2`, `Tier 3`.
- **Tier_Rate**: The dollar rate associated with a Tier_Code for a given warranty and ZIP.
- **Tier_Warranty**: One of the three warranty companies that trigger tier display — Assurant, GE Appliances, Miele. Other warranties are non-Tier_Warranties.
- **Warranty_Normalizer**: A function that maps the free-form `ticket.account` / `ticket.warrantyType` / `ticket.ticketSource` strings to one of `assurant`, `ge`, `miele`, or `other`, tolerating label variations such as `ASSURANT SOLUTIONS`, `GE APPLIANCES`, `Miele USA`.
- **Customer_Zip**: The 5-digit ZIP code on the ticket's customer record, exposed as `ticket.zip` on the flat ticket shape.
- **Base_Rate_Fallback**: The value returned by the Tier_Lookup_Module when the Customer_Zip is not present in the warranty's rate sheet.

## Requirements

### Requirement 1: Identify Tier-Eligible Tickets

**User Story:** As a CSR opening a ticket, I want the system to recognize when a ticket belongs to Assurant, GE, or Miele, so that tier information is only shown for the three warranties that use it.

#### Acceptance Criteria

1. THE Warranty_Normalizer SHALL classify a ticket as `assurant` WHEN the ticket's account, warranty type, or ticket source contains the substring `ASSURANT` (case-insensitive), ignoring surrounding whitespace and suffixes such as `SOLUTIONS`.
2. THE Warranty_Normalizer SHALL classify a ticket as `ge` WHEN the ticket's account, warranty type, or ticket source matches the token `GE` or contains the phrase `GE APPLIANCES` (case-insensitive), and SHALL NOT match unrelated substrings such as `RANGE`, `STORAGE`, or `LARGE`.
3. THE Warranty_Normalizer SHALL classify a ticket as `miele` WHEN the ticket's account, warranty type, or ticket source contains the substring `MIELE` (case-insensitive).
4. THE Warranty_Normalizer SHALL classify a ticket as `other` WHEN none of the criteria in 1.1, 1.2, or 1.3 are met.
5. WHEN the Warranty_Normalizer classifies a ticket as `other`, THE Ticket_Detail_Page SHALL NOT display any Tier_Code in the Header_Pill_Row or the General_Information_Section.

### Requirement 2: Resolve Tier Code from ZIP

**User Story:** As a CSR, I want the tier code to be resolved automatically from the customer's ZIP, so that I do not have to look it up in a spreadsheet.

#### Acceptance Criteria

1. WHEN given a warranty of `ge` and a Customer_Zip present in the GE rate sheet, THE Tier_Lookup_Module SHALL return the matching GE labor job code, its labor rate, and any associated seal-system code and rate.
2. WHEN given a warranty of `assurant` and a Customer_Zip present in the Assurant rate sheet, THE Tier_Lookup_Module SHALL return the matching Assurant tier identifier (`T200`, `T300`, or `T400` family) along with the rates for all three variants (DX fee, Two-Men & Part Replaced, Seal System).
3. WHEN given a warranty of `miele` and a Customer_Zip present in the Miele rate sheet, THE Tier_Lookup_Module SHALL return one of `Base Rate`, `Tier 1`, `Tier 2`, or `Tier 3` together with the dollar rate for that tier.
4. IF the Customer_Zip is empty, missing, or fewer than 5 digits, THEN THE Tier_Lookup_Module SHALL return a result indicating the tier could not be resolved.
5. IF the Customer_Zip is not present in the rate sheet for the given warranty, THEN THE Tier_Lookup_Module SHALL return the Base_Rate_Fallback for that warranty.
6. THE Tier_Lookup_Module SHALL normalize the Customer_Zip by stripping the `-NNNN` ZIP+4 suffix and any surrounding whitespace before performing the lookup.

### Requirement 3: Tier Slot in the Header Pill Row

**User Story:** As a CSR, I want the tier code visible at the top of the ticket alongside Account, Warranty, Status, etc., so that I can confirm the rate tier at a glance without scrolling.

#### Acceptance Criteria

1. THE Header_Pill_Row SHALL replace the existing `Contact` slot with a `Tier` slot in the same position (after `Schedule`).
2. WHEN the ticket is classified as a Tier_Warranty AND the Tier_Lookup_Module returns a resolved Tier_Code, THE Header_Pill_Row SHALL render the slot as the label `Tier` followed by the resolved Tier_Code.
3. WHEN the ticket is classified as a Tier_Warranty AND the Tier_Lookup_Module returns the Base_Rate_Fallback, THE Header_Pill_Row SHALL render the slot as the label `Tier` followed by the warranty's base-rate label.
4. WHEN the ticket is classified as a Tier_Warranty AND the Customer_Zip cannot be resolved per Requirement 2.4, THE Header_Pill_Row SHALL render the slot as the label `Tier` followed by an em dash `—`.
5. WHILE the ticket is classified as `other`, THE Header_Pill_Row SHALL render the slot per the resolution agreed in Open Question OQ-4 (see below).
6. THE Header_Pill_Row SHALL preserve the existing visual style, separators, and order of the surrounding slots (`Account • Warranty • Status • Product • TAT • Schedule • Tier`).

### Requirement 4: Tier Code Row in the General Information Section

**User Story:** As an office admin scheduling jobs, I want to see the tier code with its rate in the General Information section, so that I can confirm the labor rate before assigning a tech.

#### Acceptance Criteria

1. WHEN the ticket is classified as a Tier_Warranty, THE General_Information_Section SHALL display a `Tier Code` row near the customer Address field.
2. THE `Tier Code` row SHALL show, on a single line, the resolved Tier_Code and the Tier_Rate associated with that code for the ticket's warranty.
3. WHERE the warranty is `ge` AND the rate sheet provides both a labor job code and a seal-system code for the Customer_Zip, THE `Tier Code` row SHALL display both codes and both rates (per the format agreed in Open Question OQ-1).
4. WHERE the warranty is `assurant`, THE `Tier Code` row SHALL display the tier identifier and all three rate variants (per the format agreed in Open Question OQ-2).
5. IF the ticket is classified as a Tier_Warranty AND the Customer_Zip cannot be resolved per Requirement 2.4, THEN THE `Tier Code` row SHALL display the label `Tier Code` followed by `Zip required` and SHALL NOT show a rate.
6. WHILE the ticket is classified as `other`, THE General_Information_Section SHALL NOT render a `Tier Code` row.

### Requirement 5: Recompute on Address Change

**User Story:** As a CSR who corrected a customer's ZIP, I want the tier to update without reloading the page, so that the displayed tier always matches the current ZIP.

#### Acceptance Criteria

1. WHEN the user saves a change to the customer's ZIP through the existing Edit Customer Info flow, THE Ticket_Detail_Page SHALL re-run the tier lookup using the new Customer_Zip and re-render the Header_Pill_Row and General_Information_Section.
2. WHILE the user is editing the customer's ZIP but has not yet saved, THE Ticket_Detail_Page SHALL continue to display the tier resolved from the most recently saved Customer_Zip.
3. IF the saved Customer_Zip becomes empty, THEN THE Ticket_Detail_Page SHALL apply Requirement 2.4 and update the displays per Requirements 3.4 and 4.5.

### Requirement 6: Tier Rate Data Source

**User Story:** As an engineer maintaining the system, I want the tier rate tables stored in a single well-defined location, so that updates are auditable and the lookup is fast.

#### Acceptance Criteria

1. THE Tier_Lookup_Module SHALL expose the three rate sheets (Assurant, GE, Miele) through a pure synchronous API that takes a warranty identifier and a Customer_Zip and returns a tier result.
2. THE Tier_Lookup_Module SHALL store its rate data in the form agreed in Open Question OQ-6 (static TypeScript module vs. Supabase table).
3. THE Tier_Lookup_Module SHALL include unit-level coverage for: a resolved ZIP per warranty, an unknown ZIP per warranty, a malformed ZIP, and the warranty normalizer's label variations.
4. THE Tier_Lookup_Module SHALL be a separate file from `src/lib/zipCoverage.ts` and SHALL NOT modify the `tierCode` field already present on `ZipCoverageEntry` in that module.

### Requirement 7: Out-of-Scope Confirmation

**User Story:** As a stakeholder reviewing this change, I want to be sure unrelated parts of the ticket page are not affected, so that the rollout is low-risk.

#### Acceptance Criteria

1. THE feature SHALL NOT modify the visual layout or content of the Header_Pill_Row slots other than the `Contact` slot being replaced with `Tier`.
2. THE feature SHALL NOT modify any tab other than `general` in the Ticket_Detail_Page.
3. THE feature SHALL NOT alter the existing customer-edit save behavior beyond triggering the recompute described in Requirement 5.
4. THE feature SHALL NOT change ticket-list, ticket-search, or mobile-tech views.

## Open Questions

The following clarifications must be resolved with the user before design begins. Each question is referenced from the acceptance criteria above.

- **OQ-1 — GE display format**: When a GE ZIP maps to both a labor code (e.g. `MA02 $230`) and a seal-system code (e.g. `SS02 $400`), should the header pill show only the labor code (`Tier MA02`), the combined code (`Tier MA02 / SS02`), or just the tier number? And in the General Information row, should both rates be shown side-by-side, on two lines, or as `MA02 $230 / SS02 $400`?
- **OQ-2 — Assurant display format**: Should the header show only the tier family number (`Tier 200`), the primary code with rate (`Tier T200 $170`), or all three variants? Same question for the General Information row.
- **OQ-3 — Miele display format**: For Miele, do we show `Tier 2` or `Tier 2 ($270)` in the header? Confirm whether `Base Rate` should be shown as `Base Rate` or `Tier 0`.
- **OQ-4 — Header slot for non-tier warranties**: When the ticket is not from Assurant, GE, or Miele, should the new slot show the old `Contact` value, show blank, show `—`, or be omitted entirely (collapsing the separator)?
- **OQ-5 — Loss of the Contact value**: The current `Contact` value (`Sched.`, `Y`, `N`) is being removed from the header. Is this information still needed elsewhere on the page, or can the underlying `ticket.contact` field stop being surfaced?
- **OQ-6 — Storage choice**: Should the three rate tables live as static TypeScript constants in `src/lib/tierCodes.ts` (fast, no DB roundtrip, code-change to update) or in a Supabase table (admin-editable but slower)? Recommendation: static module for v1 with a follow-up admin UI noted.
- **OQ-7 — Source of warranty label**: Which of `ticket.account`, `ticket.warrantyType`, `ticket.ticketSource`, or `ticket.claimCompany` is the authoritative field for classifying the warranty? Confirm whether all four should be checked or just one.
- **OQ-8 — ZIP+4 and Canadian ZIPs**: Are any tier-warranty customers in Canada (six-character postal codes)? Should ZIP+4 (`12345-6789`) be honored when only the 5-digit prefix matches the table?
- **OQ-9 — Permissions**: Is the Tier_Code visible to all roles that can open a ticket (techs, mobile users) or restricted to office/CSR/manager roles?
