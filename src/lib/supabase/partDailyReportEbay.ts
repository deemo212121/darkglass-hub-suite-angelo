import { supabase } from "./client";

export const EBAY_ORDER_STATUSES = ["Shipped", "Cancelled", "Returned", "Refunded", "Pending"] as const;
export type EbayOrderStatus = (typeof EBAY_ORDER_STATUSES)[number];

export const EBAY_LISTING_STATUSES = ["Listed", "Sold"] as const;
export type EbayListingStatus = (typeof EBAY_LISTING_STATUSES)[number];

// Fallback only — used before the real, company-managed list (ebay_accounts,
// edited on the Assignments tab) has loaded.
export const EBAY_SALES_ACCOUNTS = ["Ebay (warehouse_101)", "Ebay (tekp07)"];

export interface EbayAccount {
  id: string;
  name: string;
}

export async function getEbayAccounts(): Promise<EbayAccount[]> {
  const { data, error } = await supabase.from("ebay_accounts").select("id, name").order("name", { ascending: true });
  if (error) throw error;
  return (data || []).map((r: any) => ({ id: r.id, name: r.name }));
}

export async function createEbayAccount(name: string): Promise<EbayAccount> {
  const { data, error } = await supabase.from("ebay_accounts").insert({ name }).select("id, name").single();
  if (error) throw error;
  return { id: data.id, name: data.name };
}

export async function deleteEbayAccount(id: string): Promise<void> {
  const { error } = await supabase.from("ebay_accounts").delete().eq("id", id);
  if (error) throw error;
}

// The branches this feature offers everywhere (Orders/Listings branch
// pickers, Assignments, Daily Branch Report) are exactly the branches
// with a row here — each one's "cent value" is the fixed cents a
// listing price for that branch always ends in (e.g. Atlanta -> $X.97).
export interface EbayBranchCent {
  branch: string;
  cents: number;
}

export async function getEbayBranchCents(): Promise<EbayBranchCent[]> {
  const { data, error } = await supabase.from("ebay_branch_cents").select("branch, cents").order("branch", { ascending: true });
  if (error) throw error;
  return (data || []).map((r: any) => ({ branch: r.branch, cents: r.cents }));
}

export async function upsertEbayBranchCent(branch: string, cents: number): Promise<void> {
  const { error } = await supabase.from("ebay_branch_cents").upsert({ branch, cents }, { onConflict: "company_id,branch" });
  if (error) throw error;
}

export async function deleteEbayBranchCent(branch: string): Promise<void> {
  const { error } = await supabase.from("ebay_branch_cents").delete().eq("branch", branch);
  if (error) throw error;
}

export interface EbayOrderRow {
  id: string;
  orderExtId: string;
  partNo: string;
  quantity: number;
  status: string;
  orderEarnings: number;
  orderDate: string;
  salesAccount: string;
  branch: string;
  notes: string;
  createdAt: string;
}

export interface EbayListingRow {
  id: string;
  partNo: string;
  ebayAccount: string;
  branch: string;
  price: number;
  quantity: number;
  listedDate: string;
  status: string;
  createdAt: string;
}

function mapOrder(r: any): EbayOrderRow {
  return {
    id: r.id,
    orderExtId: r.order_ext_id || "",
    partNo: r.part_no || "",
    quantity: r.quantity ?? 0,
    status: r.status || "",
    orderEarnings: Number(r.order_earnings) || 0,
    orderDate: r.order_date || "",
    salesAccount: r.sales_account || "",
    branch: r.branch || "",
    notes: r.notes || "",
    createdAt: r.created_at || "",
  };
}

function mapListing(r: any): EbayListingRow {
  return {
    id: r.id,
    partNo: r.part_no || "",
    ebayAccount: r.ebay_account || "",
    branch: r.branch || "",
    price: Number(r.price) || 0,
    quantity: r.quantity ?? 0,
    listedDate: r.listed_date || "",
    status: r.status || "",
    createdAt: r.created_at || "",
  };
}

export async function getEbayOrders(startDate: string, endDate: string): Promise<EbayOrderRow[]> {
  const { data, error } = await supabase
    .from("ebay_orders")
    .select("*")
    .gte("order_date", startDate)
    .lte("order_date", endDate)
    .order("order_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapOrder);
}

export async function createEbayOrder(input: {
  orderExtId: string;
  partNo: string;
  quantity: number;
  status: string;
  orderEarnings: number;
  orderDate: string;
  salesAccount: string;
  branch: string;
  notes?: string;
}): Promise<EbayOrderRow> {
  const { data, error } = await supabase
    .from("ebay_orders")
    .insert({
      order_ext_id: input.orderExtId || null,
      part_no: input.partNo || null,
      quantity: input.quantity,
      status: input.status,
      order_earnings: input.orderEarnings,
      order_date: input.orderDate,
      sales_account: input.salesAccount,
      branch: input.branch,
      notes: input.notes || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapOrder(data);
}

export async function updateEbayOrder(
  id: string,
  patch: Partial<Pick<EbayOrderRow, "orderExtId" | "partNo" | "quantity" | "status" | "orderEarnings" | "salesAccount" | "branch" | "orderDate" | "notes">>
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.orderExtId !== undefined) payload.order_ext_id = patch.orderExtId || null;
  if (patch.partNo !== undefined) payload.part_no = patch.partNo || null;
  if (patch.quantity !== undefined) payload.quantity = patch.quantity;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.orderEarnings !== undefined) payload.order_earnings = patch.orderEarnings;
  if (patch.salesAccount !== undefined) payload.sales_account = patch.salesAccount;
  if (patch.branch !== undefined) payload.branch = patch.branch;
  if (patch.orderDate !== undefined) payload.order_date = patch.orderDate;
  if (patch.notes !== undefined) payload.notes = patch.notes || null;
  const { error } = await supabase.from("ebay_orders").update(payload).eq("id", id);
  if (error) throw error;
}

export async function deleteEbayOrder(id: string): Promise<void> {
  const { error } = await supabase.from("ebay_orders").delete().eq("id", id);
  if (error) throw error;
}

export async function getEbayListings(startDate: string, endDate: string): Promise<EbayListingRow[]> {
  const { data, error } = await supabase
    .from("ebay_listings")
    .select("*")
    .gte("listed_date", startDate)
    .lte("listed_date", endDate)
    .order("listed_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapListing);
}

// A listing stays active until it's marked Sold (or removed), regardless
// of when it was originally listed — so "Total Listed per branch" reads
// ALL currently-Listed rows, not just the ones inside the date-range
// picker used for the Listings table itself.
export async function getActiveEbayListings(): Promise<EbayListingRow[]> {
  const { data, error } = await supabase.from("ebay_listings").select("*").eq("status", "Listed");
  if (error) throw error;
  return (data || []).map(mapListing);
}

export async function createEbayListing(input: {
  partNo: string;
  ebayAccount: string;
  branch: string;
  price: number;
  quantity: number;
  listedDate: string;
  status: string;
}): Promise<EbayListingRow> {
  const { data, error } = await supabase
    .from("ebay_listings")
    .insert({
      part_no: input.partNo || null,
      ebay_account: input.ebayAccount,
      branch: input.branch,
      price: input.price,
      quantity: input.quantity,
      listed_date: input.listedDate,
      status: input.status,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapListing(data);
}

export async function updateEbayListing(
  id: string,
  patch: Partial<Pick<EbayListingRow, "partNo" | "ebayAccount" | "branch" | "price" | "quantity" | "listedDate" | "status">>
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.partNo !== undefined) payload.part_no = patch.partNo || null;
  if (patch.ebayAccount !== undefined) payload.ebay_account = patch.ebayAccount;
  if (patch.branch !== undefined) payload.branch = patch.branch;
  if (patch.price !== undefined) payload.price = patch.price;
  if (patch.quantity !== undefined) payload.quantity = patch.quantity;
  if (patch.listedDate !== undefined) payload.listed_date = patch.listedDate;
  if (patch.status !== undefined) payload.status = patch.status;
  const { error } = await supabase.from("ebay_listings").update(payload).eq("id", id);
  if (error) throw error;
}

export async function deleteEbayListing(id: string): Promise<void> {
  const { error } = await supabase.from("ebay_listings").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Per-branch settings (Assigned staff, Listings status) + daily Comments ----------
// Backs the "Summary" tab's stacked-by-day branch rollup, matching the
// team's existing BRANCH/ASSIGNED/LISTINGS/SALES/RETURNS report.

export const EBAY_LISTINGS_STATUSES = ["All Listed", "Paused"] as const;
export type EbayListingsStatus = (typeof EBAY_LISTINGS_STATUSES)[number];

export interface EbayBranchSetting {
  branch: string;
  assignedTo: string;
}

export interface EbayBranchDailyNote {
  branch: string;
  noteDate: string;
  comment: string;
  /** That branch's Listings status for this one day, edited directly on the Daily Branch Report — absent means "no entry yet for this day, defaults to All Listed." */
  listingsStatus: string | null;
}

/** One branch's dated status timeline — every day it had an explicit entry, oldest first. Used to resolve "what was the status on day X" (the most recent entry at or before X, or "All Listed" if none). */
export interface EbayBranchStatusChange {
  branch: string;
  date: string;
  status: string;
}

export async function getEbayBranchSettings(): Promise<EbayBranchSetting[]> {
  const { data, error } = await supabase.from("ebay_branch_settings").select("*");
  if (error) throw error;
  return (data || []).map((r: any) => ({
    branch: r.branch,
    assignedTo: r.assigned_to || "",
  }));
}

export async function upsertEbayBranchSetting(
  branch: string,
  patch: Partial<Pick<EbayBranchSetting, "assignedTo">>
): Promise<void> {
  const payload: Record<string, unknown> = { branch };
  if (patch.assignedTo !== undefined) payload.assigned_to = patch.assignedTo || null;
  const { error } = await supabase.from("ebay_branch_settings").upsert(payload, { onConflict: "company_id,branch" });
  if (error) throw error;
}

export async function getEbayBranchDailyNotes(startDate: string, endDate: string): Promise<EbayBranchDailyNote[]> {
  const { data, error } = await supabase
    .from("ebay_branch_daily_notes")
    .select("*")
    .gte("note_date", startDate)
    .lte("note_date", endDate);
  if (error) throw error;
  return (data || []).map((r: any) => ({
    branch: r.branch,
    noteDate: r.note_date,
    comment: r.comment || "",
    listingsStatus: r.listings_status || null,
  }));
}

export async function upsertEbayBranchDailyNote(
  branch: string,
  noteDate: string,
  patch: { comment?: string; listingsStatus?: string }
): Promise<void> {
  const payload: Record<string, unknown> = { branch, note_date: noteDate };
  if (patch.comment !== undefined) payload.comment = patch.comment || null;
  if (patch.listingsStatus !== undefined) payload.listings_status = patch.listingsStatus;
  const { error } = await supabase.from("ebay_branch_daily_notes").upsert(payload, { onConflict: "company_id,branch,note_date" });
  if (error) throw error;
}

// All-time (not date-range-limited) history of dated status overrides,
// so a report for any date — including ones before the current
// date-range picker's window — can resolve "what was the status then."
export async function getEbayBranchStatusHistory(): Promise<EbayBranchStatusChange[]> {
  const { data, error } = await supabase
    .from("ebay_branch_daily_notes")
    .select("branch, note_date, listings_status")
    .not("listings_status", "is", null)
    .order("note_date", { ascending: true });
  if (error) throw error;
  return (data || []).map((r: any) => ({ branch: r.branch, date: r.note_date, status: r.listings_status as string }));
}
