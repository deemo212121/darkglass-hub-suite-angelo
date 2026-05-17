// Module + sub-module registry. Drives the generic CRUD page.
export type FieldType = "text" | "number" | "date" | "select";
export interface FieldDef {
  key: string;
  label: string;
  type?: FieldType;
  options?: string[];
  filterable?: boolean;
  editable?: boolean;
  width?: string;
}
export interface SubModuleDef {
  slug: string;
  title: string;
  description: string;
  fields: FieldDef[];
  // Custom seed generator; receives index
  seed: (i: number) => Record<string, unknown>;
  count?: number;
  custom?: "part-return-status"; // hook for special pages
}
export interface ModuleDef {
  slug: string;
  label: string;
  tagline: string;
  accent: string; // hex / oklch for accent dot
  submodules: SubModuleDef[];
}

const STATUS = ["Open", "In Progress", "Closed", "On Hold", "Cancelled"];
const PRIORITY = ["Low", "Medium", "High", "Urgent"];
const TECHS = ["A. Reyes", "M. Patel", "J. Kim", "S. Brown", "L. Ortiz", "R. Chen"];
const VENDORS = ["Encompass", "Marcone", "Reliable Parts", "1stSourceServall", "V&V Appliance"];
const PARTS = ["Drain Pump", "Door Gasket", "Control Board", "Thermistor", "Heating Element", "Compressor", "Inverter Board", "Door Switch", "Ice Maker", "Belt Kit"];
const CUSTOMERS = ["John Doe", "Jane Smith", "Acme LLC", "Beth Larsen", "Carlos Mora", "Priya Shah", "Tom O'Neil", "Lily Park"];
const CITIES = ["Houston", "Dallas", "Austin", "San Antonio", "Plano", "Frisco", "Sugar Land", "Katy"];
const ACCOUNTS = ["4930403","4930404","4930405","4930406","4930407","4930408","4930409","4930410","4930411","4930412","4930413","4930414","4930415","4930416","4930417","4930418"];
const REASONS = ["Defective", "Wrong Part", "Not Needed", "Damaged in Shipping", "Customer Cancel"];

const pick = <T,>(arr: T[], i: number) => arr[i % arr.length];
const pad = (n: number, len = 4) => String(n).padStart(len, "0");
const dateStr = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

// --- Dashboard ---
const dashboardMod: ModuleDef = {
  slug: "dashboard",
  label: "Dashboard",
  tagline: "Operational overview & activity",
  accent: "#3b82f6",
  submodules: [
    {
      slug: "overview",
      title: "Overview",
      description: "Top-line KPIs and recent activity.",
      fields: [
        { key: "metric", label: "Metric", filterable: true },
        { key: "value", label: "Value", type: "number" },
        { key: "trend", label: "Trend", type: "select", options: ["Up", "Down", "Flat"], filterable: true, editable: true },
        { key: "updated", label: "Updated", type: "date" },
      ],
      count: 12,
      seed: (i) => ({
        metric: ["Open Tickets","Closed Today","Parts On Order","Avg. Repair Time","First-Visit Fix %","Tech Utilization","Backorders","SLA Breaches","New Customers","Returns Pending","Revenue (wk)","Open POs"][i % 12],
        value: 100 + i * 7,
        trend: pick(["Up","Down","Flat"], i),
        updated: dateStr(-i),
      }),
    },
    {
      slug: "daily-activity",
      title: "Daily Activity",
      description: "What happened across the team today.",
      fields: [
        { key: "tech", label: "Technician", type: "select", options: TECHS, filterable: true },
        { key: "ticketsClosed", label: "Closed", type: "number" },
        { key: "ticketsOpened", label: "Opened", type: "number" },
        { key: "miles", label: "Miles", type: "number" },
        { key: "date", label: "Date", type: "date", filterable: true },
      ],
      seed: (i) => ({
        tech: pick(TECHS, i),
        ticketsClosed: (i % 7) + 1,
        ticketsOpened: (i % 5) + 1,
        miles: 20 + (i * 11) % 180,
        date: dateStr(-(i % 14)),
      }),
    },
    {
      slug: "overall-status",
      title: "Overall Status",
      description: "System-wide health & queues.",
      fields: [
        { key: "queue", label: "Queue", filterable: true },
        { key: "count", label: "Count", type: "number" },
        { key: "owner", label: "Owner", type: "select", options: TECHS, editable: true },
        { key: "status", label: "Status", type: "select", options: ["Green","Yellow","Red"], editable: true, filterable: true },
      ],
      count: 14,
      seed: (i) => ({
        queue: ["Dispatch","Diagnostics","Parts Pending","Customer Contact","Invoicing","Returns","Warranty","Escalations"][i % 8] + " #" + (i+1),
        count: 3 + (i*5)%40,
        owner: pick(TECHS, i),
        status: pick(["Green","Yellow","Red"], i),
      }),
    },
    {
      slug: "repair-forecast",
      title: "Repair Forecast",
      description: "Expected volume & parts needs.",
      fields: [
        { key: "week", label: "Week", filterable: true },
        { key: "forecast", label: "Forecast Jobs", type: "number" },
        { key: "capacity", label: "Capacity", type: "number" },
        { key: "topPart", label: "Top Part", type: "select", options: PARTS, filterable: true },
      ],
      count: 12,
      seed: (i) => ({
        week: `W${i + 1}`,
        forecast: 80 + (i * 13) % 90,
        capacity: 100 + (i % 5) * 10,
        topPart: pick(PARTS, i),
      }),
    },
  ],
};

// --- Parts ---
const partsCommonFields = (extra: FieldDef[] = []): FieldDef[] => [
  { key: "partNo", label: "Part #", filterable: true },
  { key: "description", label: "Description", filterable: true },
  { key: "vendor", label: "Vendor", type: "select", options: VENDORS, filterable: true },
  ...extra,
];

const partsMod: ModuleDef = {
  slug: "parts",
  label: "Parts",
  tagline: "Inventory, orders, returns & PO tracking",
  accent: "#22d3ee",
  submodules: [
    {
      slug: "part-collection",
      title: "Part Collection",
      description: "Manage part collections and groupings.",
      fields: partsCommonFields([
        { key: "qty", label: "Qty", type: "number", editable: true },
        { key: "location", label: "Location", filterable: true },
      ]),
      seed: (i) => ({
        partNo: "PC-" + pad(1000 + i),
        description: pick(PARTS, i),
        vendor: pick(VENDORS, i),
        qty: (i * 3) % 25 + 1,
        location: pick(["Truck 1","Truck 2","Warehouse","Tech Bag"], i),
      }),
    },
    {
      slug: "part-footprint",
      title: "Part Footprint",
      description: "Where parts physically live.",
      fields: partsCommonFields([
        { key: "bin", label: "Bin", filterable: true },
        { key: "qty", label: "Qty", type: "number" },
      ]),
      seed: (i) => ({
        partNo: "PF-" + pad(2000 + i),
        description: pick(PARTS, i),
        vendor: pick(VENDORS, i),
        bin: `B-${(i%5)+1}-${(i%9)+1}`,
        qty: (i*4) % 30 + 1,
      }),
    },
    {
      slug: "part-history",
      title: "Part History",
      description: "All transactions across parts.",
      fields: partsCommonFields([
        { key: "action", label: "Action", type: "select", options: ["Received","Issued","Returned","Adjusted"], filterable: true },
        { key: "date", label: "Date", type: "date" },
      ]),
      seed: (i) => ({
        partNo: "PH-" + pad(3000 + i),
        description: pick(PARTS, i),
        vendor: pick(VENDORS, i),
        action: pick(["Received","Issued","Returned","Adjusted"], i),
        date: dateStr(-(i % 30)),
      }),
    },
    {
      slug: "part-inventory",
      title: "Part Inventory",
      description: "Stock counts and reorder points.",
      fields: partsCommonFields([
        { key: "onHand", label: "On Hand", type: "number", editable: true },
        { key: "reorder", label: "Reorder", type: "number", editable: true },
        { key: "cost", label: "Cost", type: "number" },
      ]),
      seed: (i) => ({
        partNo: "PI-" + pad(4000 + i),
        description: pick(PARTS, i),
        vendor: pick(VENDORS, i),
        onHand: (i*2) % 40, reorder: 5, cost: 20 + (i*7)%200,
      }),
    },
    {
      slug: "part-management",
      title: "Part Management",
      description: "PO management & part settings.",
      fields: partsCommonFields([
        { key: "po", label: "PO #", filterable: true },
        { key: "status", label: "Status", type: "select", options: STATUS, editable: true, filterable: true },
      ]),
      seed: (i) => ({
        partNo: "PM-" + pad(5000 + i),
        description: pick(PARTS, i),
        vendor: pick(VENDORS, i),
        po: "PO-" + pad(7000 + i),
        status: pick(STATUS, i),
      }),
    },
    {
      slug: "part-order",
      title: "Part Order",
      description: "Place and track part orders.",
      fields: partsCommonFields([
        { key: "qty", label: "Qty", type: "number", editable: true },
        { key: "needed", label: "Needed By", type: "date" },
        { key: "status", label: "Status", type: "select", options: ["Draft","Sent","Confirmed","Shipped"], editable: true, filterable: true },
      ]),
      seed: (i) => ({
        partNo: "PO-" + pad(6000 + i),
        description: pick(PARTS, i),
        vendor: pick(VENDORS, i),
        qty: (i%5)+1,
        needed: dateStr(7 + (i%14)),
        status: pick(["Draft","Sent","Confirmed","Shipped"], i),
      }),
    },
    {
      slug: "part-pickup",
      title: "Part Pickup",
      description: "Schedule and confirm pickups.",
      fields: partsCommonFields([
        { key: "pickupDate", label: "Pickup", type: "date" },
        { key: "tech", label: "Tech", type: "select", options: TECHS, filterable: true },
      ]),
      seed: (i) => ({
        partNo: "PK-" + pad(8000 + i),
        description: pick(PARTS, i),
        vendor: pick(VENDORS, i),
        pickupDate: dateStr((i%10)),
        tech: pick(TECHS, i),
      }),
    },
    {
      slug: "part-receive",
      title: "Part Receive",
      description: "Receive parts into inventory.",
      fields: partsCommonFields([
        { key: "qty", label: "Qty", type: "number", editable: true },
        { key: "received", label: "Received", type: "date" },
        { key: "by", label: "Received By", type: "select", options: TECHS, editable: true },
      ]),
      seed: (i) => ({
        partNo: "RC-" + pad(9000 + i),
        description: pick(PARTS, i),
        vendor: pick(VENDORS, i),
        qty: (i%6)+1,
        received: dateStr(-(i%10)),
        by: pick(TECHS, i),
      }),
    },
    {
      slug: "part-return",
      title: "Part Return",
      description: "Initiate returns to vendors.",
      fields: partsCommonFields([
        { key: "reason", label: "Reason", type: "select", options: REASONS, editable: true, filterable: true },
        { key: "ra", label: "RA #", editable: true },
      ]),
      seed: (i) => ({
        partNo: "PR-" + pad(10000 + i),
        description: pick(PARTS, i),
        vendor: pick(VENDORS, i),
        reason: pick(REASONS, i),
        ra: "RA-" + pad(500 + i),
      }),
    },
    {
      slug: "part-return-status",
      title: "Part Return Status",
      description: "Regular & Core return tracking.",
      fields: [], // handled by custom page
      seed: () => ({}),
      custom: "part-return-status",
    },
    {
      slug: "po-status",
      title: "PO Status",
      description: "Outstanding POs by vendor.",
      fields: [
        { key: "po", label: "PO #", filterable: true },
        { key: "vendor", label: "Vendor", type: "select", options: VENDORS, filterable: true },
        { key: "lines", label: "Lines", type: "number" },
        { key: "value", label: "Value", type: "number" },
        { key: "status", label: "Status", type: "select", options: ["Open","Partial","Closed"], editable: true, filterable: true },
      ],
      seed: (i) => ({
        po: "PO-" + pad(7000 + i),
        vendor: pick(VENDORS, i),
        lines: (i%6)+1,
        value: 100 + (i*47)%2000,
        status: pick(["Open","Partial","Closed"], i),
      }),
    },
    {
      slug: "return-pickup",
      title: "Return Pickup",
      description: "Track outbound return pickups.",
      fields: [
        { key: "ra", label: "RA #", filterable: true },
        { key: "vendor", label: "Vendor", type: "select", options: VENDORS, filterable: true },
        { key: "carrier", label: "Carrier", type: "select", options: ["UPS","FedEx","USPS","Vendor"], filterable: true },
        { key: "tracking", label: "Tracking", editable: true },
        { key: "pickupDate", label: "Pickup", type: "date" },
      ],
      seed: (i) => ({
        ra: "RA-" + pad(500 + i),
        vendor: pick(VENDORS, i),
        carrier: pick(["UPS","FedEx","USPS","Vendor"], i),
        tracking: "1Z" + pad(1000000 + i*37, 8),
        pickupDate: dateStr((i%14)-3),
      }),
    },
  ],
};

// --- Tickets ---
const ticketsMod: ModuleDef = {
  slug: "tickets",
  label: "Tickets",
  tagline: "Service tickets, follow-ups & scheduling",
  accent: "#a78bfa",
  submodules: [
    {
      slug: "ticket-list",
      title: "Ticket List",
      description: "All service tickets.",
      fields: [
        { key: "id", label: "Ticket #", filterable: true },
        { key: "customer", label: "Customer", filterable: true },
        { key: "city", label: "City", type: "select", options: CITIES, filterable: true },
        { key: "tech", label: "Tech", type: "select", options: TECHS, filterable: true, editable: true },
        { key: "priority", label: "Priority", type: "select", options: PRIORITY, editable: true, filterable: true },
        { key: "status", label: "Status", type: "select", options: STATUS, editable: true, filterable: true },
        { key: "scheduled", label: "Scheduled", type: "date" },
      ],
      count: 24,
      seed: (i) => ({
        id: "T-" + pad(20000 + i),
        customer: pick(CUSTOMERS, i),
        city: pick(CITIES, i),
        tech: pick(TECHS, i),
        priority: pick(PRIORITY, i),
        status: pick(STATUS, i),
        scheduled: dateStr((i%21)-7),
      }),
    },
    {
      slug: "ticket-details",
      title: "Ticket Details",
      description: "Deep-dive on individual tickets.",
      fields: [
        { key: "id", label: "Ticket #", filterable: true },
        { key: "appliance", label: "Appliance", type: "select", options: ["Washer","Dryer","Fridge","Range","Dishwasher","Microwave"], filterable: true },
        { key: "symptom", label: "Symptom", editable: true },
        { key: "diagnosis", label: "Diagnosis", editable: true },
        { key: "status", label: "Status", type: "select", options: STATUS, editable: true, filterable: true },
      ],
      seed: (i) => ({
        id: "T-" + pad(20000 + i),
        appliance: pick(["Washer","Dryer","Fridge","Range","Dishwasher","Microwave"], i),
        symptom: ["Not heating","Leaking","Won't start","Noisy","Error code"][i%5],
        diagnosis: ["Faulty board","Drain clog","Door switch","Belt worn","Sensor bad"][i%5],
        status: pick(STATUS, i),
      }),
    },
    {
      slug: "followup",
      title: "Follow-up",
      description: "Outstanding follow-ups and callbacks.",
      fields: [
        { key: "id", label: "Ticket #", filterable: true },
        { key: "customer", label: "Customer", filterable: true },
        { key: "due", label: "Due", type: "date" },
        { key: "owner", label: "Owner", type: "select", options: TECHS, editable: true, filterable: true },
        { key: "note", label: "Note", editable: true },
      ],
      seed: (i) => ({
        id: "T-" + pad(20000 + i),
        customer: pick(CUSTOMERS, i),
        due: dateStr((i%10)),
        owner: pick(TECHS, i),
        note: ["Awaiting part","Customer callback","Quote pending","Reschedule"][i%4],
      }),
    },
    {
      slug: "sms-list",
      title: "SMS List",
      description: "SMS conversations with customers.",
      fields: [
        { key: "customer", label: "Customer", filterable: true },
        { key: "phone", label: "Phone" },
        { key: "last", label: "Last Message", editable: true },
        { key: "direction", label: "Dir", type: "select", options: ["In","Out"], filterable: true },
        { key: "when", label: "When", type: "date" },
      ],
      seed: (i) => ({
        customer: pick(CUSTOMERS, i),
        phone: `(${713 + (i%3)}) 555-${pad(1000 + i*13, 4)}`,
        last: ["On the way","Running late 15m","Confirmed","Part arrived"][i%4],
        direction: i%2 ? "Out" : "In",
        when: dateStr(-(i%5)),
      }),
    },
    {
      slug: "todo-list",
      title: "To-Do List",
      description: "Personal & team tasks.",
      fields: [
        { key: "task", label: "Task", filterable: true, editable: true },
        { key: "owner", label: "Owner", type: "select", options: TECHS, editable: true, filterable: true },
        { key: "priority", label: "Priority", type: "select", options: PRIORITY, editable: true },
        { key: "due", label: "Due", type: "date" },
        { key: "status", label: "Status", type: "select", options: ["Todo","Doing","Done"], editable: true, filterable: true },
      ],
      seed: (i) => ({
        task: ["Order belt kit","Call back Mrs. Park","Confirm tomorrow's route","Submit warranty claim","Update inventory"][i%5] + " #" + (i+1),
        owner: pick(TECHS, i),
        priority: pick(PRIORITY, i),
        due: dateStr((i%10)),
        status: pick(["Todo","Doing","Done"], i),
      }),
    },
    {
      slug: "work-calendar",
      title: "Work Calendar",
      description: "Scheduled jobs by date.",
      fields: [
        { key: "date", label: "Date", type: "date", filterable: true },
        { key: "slot", label: "Slot", type: "select", options: ["AM","PM","Eve"], filterable: true },
        { key: "tech", label: "Tech", type: "select", options: TECHS, filterable: true },
        { key: "customer", label: "Customer", filterable: true },
        { key: "city", label: "City", type: "select", options: CITIES, filterable: true },
      ],
      count: 24,
      seed: (i) => ({
        date: dateStr((i%14)-3),
        slot: pick(["AM","PM","Eve"], i),
        tech: pick(TECHS, i),
        customer: pick(CUSTOMERS, i),
        city: pick(CITIES, i),
      }),
    },
    {
      slug: "work-map",
      title: "Work Map",
      description: "Geographic view of today's jobs.",
      fields: [
        { key: "id", label: "Ticket #", filterable: true },
        { key: "city", label: "City", type: "select", options: CITIES, filterable: true },
        { key: "address", label: "Address" },
        { key: "tech", label: "Tech", type: "select", options: TECHS, filterable: true },
        { key: "eta", label: "ETA" },
      ],
      seed: (i) => ({
        id: "T-" + pad(20000 + i),
        city: pick(CITIES, i),
        address: `${100 + i*11} Main St`,
        tech: pick(TECHS, i),
        eta: `${8 + (i%9)}:${i%2 ? "30" : "00"} ${i%9 < 4 ? "AM" : "PM"}`,
      }),
    },
  ],
};

export const MODULES: ModuleDef[] = [dashboardMod, partsMod, ticketsMod];

export function getModule(slug: string) {
  return MODULES.find((m) => m.slug === slug);
}
export function getSubModule(modSlug: string, subSlug: string) {
  return getModule(modSlug)?.submodules.find((s) => s.slug === subSlug);
}

export const PART_RETURN_ACCOUNTS = ACCOUNTS;
export const PART_RETURN_REASONS = REASONS;
export const PART_RETURN_STATUSES = ["Pending Pickup","Picked Up","In Transit","Received","Credited","Rejected"];
export const PART_RETURN_TECHS = TECHS;
export const PART_RETURN_VENDORS = ["Encompass","Marcone"];
