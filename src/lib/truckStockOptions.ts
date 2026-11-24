/**
 * Part Inventory → Truck Stock's two dropdowns — the same lists and colours
 * as the inventory workbook's: Status and Description.
 *
 * Status is what the part is doing now. Only IN STOCK is available (Marcone
 * Lookup's in-house counts and transfer requests read status in_stock only);
 * SOLD / B2B / RETURN / USED / MISSING are the ones the workbook import
 * treats as gone from the shelf (truckStockFile.ts GONE). Choosing USED or
 * MISSING on a row asks how many and moves them to the Used / Missing list.
 * Rows saved before these existed may still say In Use — shown, not offered.
 *
 * Description is the stock's label (which eBay account, OOW, branch use…).
 * Older rows can hold other text (part names, "Below $20" …): it's kept and
 * shown as the row's current value — never wiped by editing the row.
 */
import type { TruckStockStatus } from "@/lib/supabase/truckStock";

export interface TruckStockOption<T extends string = string> {
  value: T;
  label: string;
  /** Table chip (Tailwind classes, dark theme). */
  chip: string;
  /** Dropdown option colours (inline style — native <option>s take no classes). */
  option: { backgroundColor: string; color: string };
}

const RED = { chip: "border-red-500/50 bg-red-700 text-white", option: { backgroundColor: "#b91c1c", color: "#ffffff" } };
const LIGHT_GREEN = { chip: "border-green-300/50 bg-green-200 text-green-900", option: { backgroundColor: "#bbf7d0", color: "#14532d" } };
const DARK_GREEN = { chip: "border-green-500/50 bg-green-700 text-white", option: { backgroundColor: "#15803d", color: "#ffffff" } };
const LIGHT_PURPLE = { chip: "border-purple-300/50 bg-purple-200 text-purple-900", option: { backgroundColor: "#e9d5ff", color: "#581c87" } };

export const TRUCK_STOCK_STATUSES: TruckStockOption<TruckStockStatus>[] = [
  { value: "sold", label: "SOLD", ...RED },
  { value: "in_stock", label: "IN STOCK", ...LIGHT_GREEN },
  { value: "ebay", label: "EBAY", ...LIGHT_PURPLE },
  { value: "b2b", label: "B2B", chip: "border-cyan-500/50 bg-cyan-800 text-white", option: { backgroundColor: "#155e75", color: "#ffffff" } },
  { value: "return", label: "RETURN", chip: "border-white/30 bg-neutral-800 text-white", option: { backgroundColor: "#262626", color: "#ffffff" } },
  { value: "ticket", label: "TICKET", ...DARK_GREEN },
  { value: "used", label: "USED", ...RED },
  // Migration 0478: off the row onto Truck Stock's Missing list until Found.
  { value: "missing", label: "MISSING", chip: "border-orange-400/50 bg-orange-600 text-white", option: { backgroundColor: "#ea580c", color: "#ffffff" } },
];

/** Older rows only — not offered any more. */
const IN_USE: TruckStockOption<TruckStockStatus> = {
  value: "in_use",
  label: "IN USE",
  chip: "border-amber-400/30 bg-amber-500/15 text-amber-200",
  option: { backgroundColor: "#78350f", color: "#ffffff" },
};

export function truckStockStatusOption(status: TruckStockStatus): TruckStockOption<TruckStockStatus> {
  return TRUCK_STOCK_STATUSES.find((s) => s.value === status) ?? IN_USE;
}

export const TRUCK_STOCK_DESCRIPTIONS: TruckStockOption[] = [
  { value: "Tepk07", label: "Tepk07", ...LIGHT_PURPLE },
  { value: "Warehouse101", label: "Warehouse101", chip: "border-fuchsia-300/50 bg-fuchsia-400 text-fuchsia-950", option: { backgroundColor: "#e879f9", color: "#4a044e" } },
  { value: "OOW", label: "OOW", chip: "border-blue-400/50 bg-blue-700 text-white", option: { backgroundColor: "#1d4ed8", color: "#ffffff" } },
  { value: "SHIPPED", label: "SHIPPED", ...LIGHT_GREEN },
  { value: "BRANCH USE ONLY", label: "BRANCH USE ONLY", ...RED },
  { value: "TICKET", label: "TICKET", ...DARK_GREEN },
  { value: "USED", label: "USED", ...RED },
];

/**
 * Brand dropdown — the appliance brands on our tickets (tickets.manufacturer,
 * 2026-11-17), each once: "GENERAL ELECTRIC" / "GE" → GE, "LG ELECTRONICS" → LG,
 * "THERMADORE" → Thermador, Frigidaire typos → Frigidaire … Warranty companies
 * (Assurant, Square Trade, AIG, Centricity) and notes ("Verify to the customer")
 * left out. A row's older brand that isn't listed is kept as its current value.
 */
export const TRUCK_STOCK_BRANDS: string[] = [
  "Amana", "Avanti", "Beko", "Bertazzoni", "Bosch", "Cafe", "Cosmo", "Criterion", "Crosley", "Dacor", "Danby",
  "Electrolux", "Element", "Forno", "Frigidaire", "Galanz", "GE", "Haier", "Hisense", "Hotpoint", "IKEA", "Insignia",
  "JennAir", "Kenmore", "KitchenAid", "LG", "Maytag", "Midea", "Miele", "Monogram", "Mora", "NXR", "Profile", "RCA",
  "Samsung", "Scotsman", "Sharp", "Sony", "Speed Queen", "Sub-Zero", "TCL", "Thermador", "Thor", "Toshiba", "U-Line",
  "Vesta", "Viking", "Vissani", "Whirlpool", "Wolf", "Zephyr", "ZLINE",
];

/** The listed brand this text is (any case / spacing / hyphen), or undefined for other text. */
export function truckStockBrandValue(brand: string | null | undefined): string | undefined {
  const key = String(brand ?? "").toLowerCase().replace(/[\s-]+/g, "");
  return key ? TRUCK_STOCK_BRANDS.find((b) => b.toLowerCase().replace(/[\s-]+/g, "") === key) : undefined;
}

/** The listed description this text is (any case / spacing), or undefined for other text. */
export function truckStockDescriptionOption(description: string | null | undefined): TruckStockOption | undefined {
  const key = String(description ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return key ? TRUCK_STOCK_DESCRIPTIONS.find((d) => d.value.toLowerCase() === key) : undefined;
}
