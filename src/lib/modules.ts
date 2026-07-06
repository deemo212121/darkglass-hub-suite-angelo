import { ALL_TECHNICIANS, PARTS_FROM_OPTIONS, WORK_MAP_LOCATIONS } from "@/lib/locations";

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
  custom?: "part-return" | "part-return-status" | "claims-pipeline" | "work-map" | "part-order" | "part-receive" | "return-pickup" | "repair-statuses" | "ticket-list" | "user-management" | "account-management" | "location-management" | "csr-daily-report" | "call-tracker" | "csr-status-summary" | "reserved-part-list-custom" | "parts-dashboard" | "truck-stock"; // hook for special pages
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
const TECHS = ALL_TECHNICIANS;
const VENDORS = ["Encompass", "Marcone", "Reliable Parts", "1stSourceServall", "V&V Appliance"];
const PARTS = ["Drain Pump", "Door Gasket", "Control Board", "Thermistor", "Heating Element", "Compressor", "Inverter Board", "Door Switch", "Ice Maker", "Belt Kit"];
const CUSTOMERS = ["John Doe", "Jane Smith", "Acme LLC", "Beth Larsen", "Carlos Mora", "Priya Shah", "Tom O'Neil", "Lily Park"];
const CITIES = ["Houston", "Dallas", "Austin", "San Antonio", "Plano", "Frisco", "Sugar Land", "Katy"];
const ACCOUNTS = ["4930403","4930404","4930405","4930406","4930407","4930408","4930409","4930410","4930411","4930412","4930413","4930414","4930415","4930416","4930417","4930418"];
export const LOGIN_COMPANY_OPTIONS = ACCOUNTS;
const REASONS = ["Defective", "Wrong Part", "Not Needed", "Damaged in Shipping", "Customer Cancel"];
const APPLIANCES = ["Washer", "Dryer", "Refrigerator", "Range/Oven", "Dishwasher", "Microwave"];
const LOCATIONS = ["Main Warehouse", "Truck 1", "Truck 2", "Tech Bag", "Branch - North", "Branch - South"];
const BRANCHES = ["Houston HQ", "Dallas", "Austin", "San Antonio"];
const CARRIERS = ["UPS", "FedEx", "USPS", "Vendor Pickup"];
const ACTIVITY_TYPES = ["Collection", "Return", "Repair", "Inspection", "Diagnosis", "Installation"];
const PART_CATEGORIES = ["Motor", "Control", "Hardware", "Sensor", "Seal"];
const COLLECTION_STATUS = ["Pending", "Scheduled", "In-Transit", "Completed"];
const APPLIANCE_ISSUES = ["Not heating", "Leaking", "Won't start", "Noisy", "Error code", "Door stuck", "Not cooling"];
const DIAGNOSES = ["Faulty board", "Drain clog", "Door switch", "Belt worn", "Sensor bad", "Compressor issue"];
const RETURN_REASONS_DETAILED = ["Defective", "Wrong Part", "Not Needed", "Damaged in Shipping", "Customer Cancel", "Received damaged", "Quality issue"];
const LOCATIONS_FOR_STORAGE = ["Section A-1", "Section A-2", "Section B-1", "Section B-2", "Section C-1", "Overflow"];
const REFUND_METHODS = ["Original Card", "Check", "Store Credit", "PayPal", "Bank Transfer"];

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
      slug: "daily-activity",
      title: "Daily Activity Report",
      description: "Review daily operational activities summary.",
      fields: [
        { key: "tech", label: "Technician", type: "select", options: TECHS, filterable: true },
        { key: "activityType", label: "Activity", type: "select", options: ACTIVITY_TYPES, filterable: true },
        { key: "ticketsClosed", label: "Closed", type: "number" },
        { key: "ticketsOpened", label: "Opened", type: "number" },
        { key: "miles", label: "Miles", type: "number" },
        { key: "date", label: "Date", type: "date", filterable: true },
      ],
      count: 30,
      seed: (i) => ({
        tech: pick(TECHS, i),
        activityType: pick(ACTIVITY_TYPES, i),
        ticketsClosed: (i % 7) + 1,
        ticketsOpened: (i % 5) + 1,
        miles: 20 + (i * 11) % 180,
        date: dateStr(-(i % 14)),
      }),
    },
    {
      slug: "overall-status",
      title: "Overall Status",
      description: "View system-wide status and health metrics.",
      fields: [
        { key: "queue", label: "Queue", filterable: true },
        { key: "count", label: "Count", type: "number" },
        { key: "owner", label: "Owner", type: "select", options: TECHS, editable: true },
        { key: "status", label: "Status", type: "select", options: ["Green","Yellow","Red"], editable: true, filterable: true },
      ],
      count: 14,
      seed: (i) => ({
        queue: ["Dispatch","Diagnostics","Parts Pending","Customer Contact","Invoicing","Returns","Warranty","Escalations"][i % 8] + " #" + (i + 1),
        count: 3 + (i * 5) % 40,
        owner: pick(TECHS, i),
        status: pick(["Green","Yellow","Red"], i),
      }),
    },
    {
      slug: "accounting-dashboard",
      title: "Accounting Dashboard",
      description: "Attendance monitoring, payroll calculation, and employee time tracking.",
      custom: "accounting-dashboard" as any,
      fields: [],
      count: 0,
      seed: () => ({}),
    },
    {
      slug: "attendance-monitoring",
      title: "Attendance Monitoring Dashboard",
      description: "Track daily attendance, late arrivals, and absences.",
      custom: "attendance-monitoring" as any,
      fields: [],
      count: 0,
      seed: () => ({}),
    },
    {
      slug: "payroll-calculation",
      title: "Payroll Calculation Dashboard",
      description: "Calculate and manage employee payroll with deductions.",
      custom: "payroll-calculation" as any,
      fields: [
        { key: "employeeName", label: "Employee", filterable: true },
        { key: "period", label: "Period", filterable: true },
        { key: "regularHours", label: "Regular Hours", type: "number" },
        { key: "overtimeHours", label: "Overtime Hours", type: "number" },
        { key: "ptoHours", label: "PTO Hours", type: "number" },
        { key: "grossPay", label: "Gross Pay", type: "number" },
        { key: "deductions", label: "Deductions", type: "number" },
        { key: "netPay", label: "Net Pay", type: "number" },
      ],
      count: 30,
      seed: (i) => {
        const regularHours = 160 + (i % 20);
        const overtimeHours = i % 5;
        const grossPay = regularHours * 20 + overtimeHours * 30;
        const deductions = Math.round(grossPay * 0.2);
        return {
          employeeName: pick(TECHS, i),
          period: `Jun ${(i % 2) ? "1-15" : "16-30"}, 2026`,
          regularHours,
          overtimeHours,
          ptoHours: i % 3,
          grossPay,
          deductions,
          netPay: grossPay - deductions,
        };
      },
    },
    {
      slug: "employee-self-service",
      title: "Employee Self-Service Portal",
      description: "Allow employees to view timecards and request time off.",
      custom: "employee-self-service" as any,
      fields: [
        { key: "employeeName", label: "Employee", filterable: true },
        { key: "availableBalance", label: "Available PTO Balance", type: "number" },
        { key: "usedBalance", label: "Used PTO", type: "number" },
        { key: "pendingRequests", label: "Pending Requests", type: "number" },
      ],
      count: 20,
      seed: (i) => ({
        employeeName: pick(TECHS, i),
        availableBalance: 15 - (i % 5),
        usedBalance: i % 10,
        pendingRequests: i % 3,
      }),
    },

    {
      slug: "expense-tracking",
      title: "Tracking Expenses Dashboard",
      description: "Track and manage employee expenses and reimbursements.",
      fields: [
        { key: "employeeName", label: "Employee", filterable: true },
        { key: "category", label: "Category", type: "select", options: ["Travel", "Supplies", "Meals", "Other"], filterable: true },
        { key: "date", label: "Date", type: "date" },
        { key: "amount", label: "Amount", type: "number" },
        { key: "description", label: "Description", filterable: true },
        { key: "status", label: "Status", type: "select", options: ["Pending", "Approved", "Reimbursed"], filterable: true },
      ],
      count: 40,
      seed: (i) => {
        const categories = ["Travel", "Supplies", "Meals", "Other"];
        const statuses = ["Pending", "Approved", "Reimbursed"];
        return {
          employeeName: pick(TECHS, i),
          category: pick(categories, i),
          date: dateStr(-(i % 20)),
          amount: 25 + (i * 13) % 250,
          description: `Expense for ${pick(categories, i)}`,
          status: pick(statuses, i),
        };
      },
    },
    {
      slug: "csr-dashboard",
      title: "CSR Dashboard",
      description: "CSR team performance metrics and real-time monitoring.",
      custom: "csr-dashboard" as any,
      fields: [],
      count: 0,
      seed: () => ({}),
    },
    {
      slug: "csr-daily-report",
      title: "CSR Daily Report",
      description: "CSR agent performance — tasks, schedule, attempts, mistakes.",
      custom: "csr-daily-report" as any,
      fields: [],
      count: 0,
      seed: () => ({}),
    },
    {
      slug: "call-tracker",
      title: "Call Tracker",
      description: "Track and monitor incoming and outgoing calls.",
      custom: "call-tracker" as any,
      fields: [],
      count: 0,
      seed: () => ({}),
    },
    {
      slug: "csr-status-summary",
      title: "Status Summary",
      description: "View CSR status summary and real-time metrics.",
      custom: "csr-status-summary" as any,
      fields: [],
      count: 0,
      seed: () => ({}),
    },
    {
      slug: "hr-dashboard",
      title: "HR & Recruitment Dashboard",
      description: "Manage job interviews, hiring pipeline, and HR metrics.",
      custom: "hr-dashboard" as any,
      fields: [],
      count: 0,
      seed: () => ({}),
    },
    {
      slug: "parts-dashboard",
      title: "Parts Dashboard",
      description: "Parts operations overview — PO queue, collections, receives and distributor breakdown.",
      custom: "parts-dashboard",
      fields: [],
      count: 0,
      seed: () => ({}),
    },
  ],
};

// --- Parts ---
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
      title: "Part Daily Collection",
      description: "Daily part collection and grouping.",
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
      title: "Part In/Out History",
      description: "All part transactions across inventory and returns.",
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
      title: "Parts PO & Management",
      description: "Purchase orders and part management controls.",
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
      custom: "part-order" as const,
    },
    {
      slug: "part-pickup",
      title: "Part Daily Pickup",
      description: "Daily pickup scheduling and confirmation.",
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
        { key: "location", label: "Location", type: "select", options: [...WORK_MAP_LOCATIONS], editable: true, filterable: true },
        { key: "partsFrom", label: "Parts From", type: "select", options: [...PARTS_FROM_OPTIONS], editable: true, filterable: true },
        { key: "qty", label: "Qty", type: "number", editable: true },
        { key: "received", label: "Received", type: "date" },
        { key: "by", label: "Received By", type: "select", options: TECHS, editable: true },
      ]),
      seed: (i) => ({
        partNo: "RC-" + pad(9000 + i),
        description: pick(PARTS, i),
        vendor: pick(VENDORS, i),
        location: pick([...WORK_MAP_LOCATIONS], i),
        partsFrom: pick([...PARTS_FROM_OPTIONS], i),
        qty: (i%6)+1,
        received: dateStr(-(i%10)),
        by: pick(TECHS, i),
      }),
      custom: "part-receive" as const,
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
      custom: "part-return",
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
      title: "P/O Status",
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
      title: "Return & Pickup",
      description: "Track outbound returns and pickup routing.",
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
      custom: "return-pickup",
    },
    {
      slug: "reserved-part-list",
      title: "Reserved Part List",
      description: "Parts currently reserved for tickets.",
      fields: [],
      seed: () => ({}),
      custom: "reserved-part-list-custom",
    },
    {
      slug: "truck-stock",
      title: "Truck Stock",
      description: "Parts in-house per branch with cross-branch availability — checked by the Marcone Lookup button before placing a PO.",
      fields: [],
      seed: () => ({}),
      custom: "truck-stock",
    },
  ],
};
const ticketsMod: ModuleDef = {
  slug: "tickets",
  label: "Tickets",
  tagline: "Service tickets, follow-ups & scheduling",
  accent: "#a78bfa",
  submodules: [
    {
      slug: "ticket-list",
      title: "Ticket List",
      description: "Complete ticket details with warranty, customer, status, and technician info.",
      fields: [
        { key: "ticketNo", label: "Ticket No", filterable: true },
        { key: "warranty", label: "Warranty", type: "select", options: ["IW","OW","XW","CLPW"], filterable: true },
        { key: "account", label: "Account", filterable: true },
        { key: "customer", label: "Customer", filterable: true },
        { key: "city", label: "City", filterable: true },
        { key: "location", label: "Location", type: "select", options: ["Atlanta","Other"], filterable: true },
        { key: "model", label: "Model", filterable: true },
        { key: "internalNote", label: "Internal Note", editable: true },
        { key: "manufacturer", label: "Manufacturer", filterable: true },
        { key: "irKit", label: "IR Kit", editable: true },
        { key: "type", label: "Type", type: "select", options: ["SMS","OSR","Phone"], filterable: true },
        { key: "branch", label: "Branch", filterable: true },
        { key: "technician", label: "Technician", type: "select", options: TECHS, editable: true, filterable: true },
        { key: "contact", label: "Contact", filterable: true },
        { key: "customerPref", label: "Cx Prefer", type: "select", options: ["Y","N"], editable: true },
        { key: "schedule", label: "Schedule", type: "date", editable: true },
        { key: "status", label: "Status", type: "select", options: ["CSR-Assigned to ASC","OP-Waiting for Part","TR-Need Triage","CSR-Needs Scheduling","CSR-Left Message for Cx","OP-UPDATE HOLD","TR-Need PO","CL-Parts Back Ordered"], filterable: true, editable: true },
        { key: "delay", label: "Delay", type: "number", editable: true },
        { key: "phone", label: "Phone", filterable: true },
        { key: "redo", label: "Redo", type: "select", options: ["Y","N"], editable: true },
        { key: "aging", label: "Aging", type: "number" },
        { key: "calls", label: "Calls", type: "number" },
        { key: "diagnosed", label: "Diagnosed", type: "select", options: ["Y","N"], editable: true },
        { key: "partOrder", label: "Part Order", type: "select", options: ["Not Diagnosed","Part Ordered","Partially Ordered",""], editable: true, filterable: true },
        { key: "created", label: "Created", type: "date" },
      ],
      count: 50,
      seed: (i) => {
        const tickets = [
          { no: "SA-3458831", wty: "IW", acct: "GSL00002", cust: "Neal Market", city: "GREENSBORO", model: "GNE27JYMFFS", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "", contact: "", pref: "N", sched: "05/21/26", status: "CSR-Assigned to ASC", delay: 0, phone: "706.817.2900", redo: "N", aging: 0, calls: 0, diag: "N", partOrder: "Not Diagnosed", created: "05/18/26" },
          { no: "26000679102DF", wty: "IW", acct: "GSL00002", cust: "Brian Rowe", city: "SHADY DALE", model: "FCRE3083AS", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "", contact: "", pref: "N", sched: "05/19/26", status: "CSR-Assigned to ASC", delay: 1, phone: "706.366.1043", redo: "N", aging: 1, calls: 0, diag: "N", partOrder: "Not Diagnosed", created: "05/17/26" },
          { no: "1007208750-10", wty: "IW", acct: "GSL00002", cust: "Charles Mcdonald", city: "GREENSBORO", model: "FRUF2020AW", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "", contact: "", pref: "N", sched: "05/19/26", status: "CSR-Assigned to ASC", delay: 1, phone: "404.680.4022", redo: "N", aging: 1, calls: 0, diag: "N", partOrder: "Not Diagnosed", created: "05/17/26" },
          { no: "027360174134", wty: "IW", acct: "GSL00002", cust: "Lauren Santori", city: "TEMPLE", model: "NE63A6511SS", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "", contact: "", pref: "N", sched: "05/20/26", status: "CSR-Assigned to ASC", delay: 1, phone: "770.820.1665", redo: "N", aging: 1, calls: 0, diag: "N", partOrder: "Not Diagnosed", created: "05/17/26" },
          { no: "26000671769DF1", wty: "IW", acct: "GSL00002", cust: "Rose Phillips", city: "ELLENWOOD", model: "DV45K7600EW", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Nathan Napora", contact: "", pref: "Y", sched: "05/18/26", status: "OP-Waiting for Part", delay: 3, phone: "404.640.7141", redo: "Y", aging: 3, calls: 0, diag: "Y", partOrder: "Part Ordered", created: "05/15/26" },
          { no: "7039321404BL-13", wty: "IW", acct: "ER", cust: "Melissa Beaver", city: "EATONTON", model: "GCCE3670AS", note: "WF 05/15 waiting for parts tracking", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Joshua Silva", contact: "", pref: "N", sched: "05/15/26", status: "OP-Waiting for Part", delay: 4, phone: "703.932.1404", redo: "Y", aging: 4, calls: 0, diag: "Y", partOrder: "Partially Ordered", created: "05/14/26" },
          { no: "SA-3433383", wty: "IW", acct: "GSL00002", cust: "Accent Overlook", city: "CANTON", model: "GDT535PSRSS", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "", contact: "", pref: "Y", sched: "05/18/26", status: "CSR-Left Message for Cx", delay: 4, phone: "770.766.0064", redo: "N", aging: 4, calls: 2, diag: "N", partOrder: "Not Diagnosed", created: "05/14/26" },
          { no: "SA-3431358", wty: "IW", acct: "GSL00002", cust: "Evelin Tirado", city: "EATONTON", model: "HDF330PGRBB", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "", contact: "", pref: "N", sched: "05/19/26", status: "CSR-Left Message for Cx", delay: 4, phone: "706.816.6545", redo: "N", aging: 4, calls: 2, diag: "N", partOrder: "Not Diagnosed", created: "05/14/26" },
          { no: "3850106E11", wty: "IW", acct: "GSL00002", cust: "Tricon Propertymanager", city: "DALLAS", model: "GTX22EASK1WW", note: "WF 05/16 - Sent message to tech", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Abel Severino", contact: "", pref: "N", sched: "05/15/26", status: "OP-UPDATE HOLD", delay: 5, phone: "678.508.7857", redo: "N", aging: 5, calls: 0, diag: "N", partOrder: "Not Diagnosed", created: "05/13/26" },
          { no: "26000663669DF1", wty: "IW", acct: "GSL00002", cust: "Shirley Gentry", city: "TAYLORSVILLE", model: "MVW7232HW", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Abel Severino", contact: "", pref: "N", sched: "05/15/26", status: "TR-Need Triage", delay: 5, phone: "770.316.3847", redo: "N", aging: 5, calls: 0, diag: "N", partOrder: "Not Diagnosed", created: "05/13/26" },
          { no: "SA-34125461", wty: "IW", acct: "GSL00002", cust: "Mike Daly", city: "ACWORTH", model: "PDT715SYVFS", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Gerrell Berg", contact: "", pref: "N", sched: "05/15/26", status: "TR-Need Triage", delay: 5, phone: "262.707.4813", redo: "N", aging: 5, calls: 1, diag: "N", partOrder: "Not Diagnosed", created: "05/13/26" },
          { no: "SA-34156911", wty: "IW", acct: "GSL00002", cust: "Chakradhar Kalivarapu", city: "CUMMING", model: "PDT715SYVFS", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Gerrell Berg", contact: "", pref: "N", sched: "05/18/26", status: "TR-Need Triage", delay: 5, phone: "314.422.0624", redo: "N", aging: 5, calls: 0, diag: "N", partOrder: "Not Diagnosed", created: "05/13/26" },
          { no: "SA-34172341", wty: "IW", acct: "GSL00002", cust: "Amy Boquist", city: "TALMO", model: "PGE29BYTFS", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Abraham Im", contact: "", pref: "Y", sched: "05/20/26", status: "CSR-Needs Scheduling", delay: 5, phone: "678.523.2213", redo: "Y", aging: 5, calls: 0, diag: "Y", partOrder: "Part Ordered", created: "05/13/26" },
          { no: "O-70646619381", wty: "OW", acct: "ER", cust: "Daiquiri Cummings", city: "OXFORD", model: "REFRIGERATOR", note: "OOW $208.20 collect", mfg: "", irKit: "", type: "SMS", branch: "", tech: "Joshua Silva", contact: "", pref: "N", sched: "05/15/26", status: "OP-UPDATE HOLD", delay: 5, phone: "706.466.1938", redo: "N", aging: 5, calls: 0, diag: "N", partOrder: "Not Diagnosed", created: "05/13/26" },
          { no: "26000663027DF1", wty: "IW", acct: "GSL00002", cust: "Antoine Caldwell", city: "JACKSON", model: "RF32CG5400SR", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Nathan Napora", contact: "", pref: "N", sched: "05/15/26", status: "TR-Need Triage", delay: 5, phone: "229.425.7275", redo: "N", aging: 5, calls: 0, diag: "N", partOrder: "Not Diagnosed", created: "05/13/26" },
          { no: "SA-33957161", wty: "IW", acct: "GSL00002", cust: "Kisha Snell", city: "ROCKMART", model: "GFW350SPYDS", note: "2 Man Job", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Jordan Brown", contact: "", pref: "Y", sched: "05/14/26", status: "CSR-Needs Scheduling", delay: 6, phone: "706.361.7869", redo: "Y", aging: 6, calls: 0, diag: "Y", partOrder: "Part Ordered", created: "05/12/26" },
          { no: "SA-33860641", wty: "IW", acct: "GSL00002", cust: "Karla Lares", city: "CANTON", model: "GNE27JYMFS", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Gerrell Berg", contact: "", pref: "Y", sched: "05/13/26", status: "CSR-Needs Scheduling", delay: 6, phone: "770.990.4210", redo: "Y", aging: 6, calls: 1, diag: "Y", partOrder: "Part Ordered", created: "05/12/26" },
          { no: "SA-33989861", wty: "IW", acct: "GSL00002", cust: "Maryann Seybold", city: "WALESKA", model: "GRS500PV1SS", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Gerrell Berg", contact: "", pref: "Y", sched: "05/14/26", status: "CSR-Needs Scheduling", delay: 6, phone: "770.630.6781", redo: "Y", aging: 6, calls: 2, diag: "Y", partOrder: "Part Ordered", created: "05/12/26" },
          { no: "O-30572561511", wty: "OW", acct: "ER", cust: "Harry Piedra", city: "Murrayville", model: "HGR30PS-LP", note: "Customer inquiring on ETA", mfg: "", irKit: "", type: "SMS", branch: "", tech: "Kevin Khaiphanliane", contact: "", pref: "Y", sched: "", status: "TR-Need PO", delay: 6, phone: "305.725.6151", redo: "Y", aging: 6, calls: 0, diag: "Y", partOrder: "", created: "05/12/26" },
          { no: "H4249184", wty: "IW", acct: "GSL00002", cust: "Kimberly Scott", city: "SPARTA", model: "HRB171N6ASE", note: "Area too far to service", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "", contact: "", pref: "N", sched: "05/18/26", status: "OP-Waiting for Part", delay: 6, phone: "478.251.9584", redo: "N", aging: 6, calls: 1, diag: "N", partOrder: "Not Diagnosed", created: "05/12/26" },
          { no: "BZ48136REL311", wty: "IW", acct: "GSL00002", cust: "Cathy Nelson", city: "ATLANTA", model: "BI48SD/S/", note: "2 man job - send Kevin", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Abel Severino", contact: "", pref: "N", sched: "05/13/26", status: "OP-UPDATE HOLD", delay: 7, phone: "954.254.2213", redo: "N", aging: 7, calls: 0, diag: "N", partOrder: "Not Diagnosed", created: "05/11/26" },
          { no: "SA-33617561", wty: "CLPW", acct: "GSL00002", cust: "Robin Parton", city: "JASPER", model: "CTS90DP4NW2", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Gerrell Berg", contact: "", pref: "N", sched: "05/13/26", status: "TR-Need Triage", delay: 7, phone: "404.276.6625", redo: "N", aging: 7, calls: 1, diag: "N", partOrder: "Not Diagnosed", created: "05/11/26" },
          { no: "O-2142645329-16", wty: "OW", acct: "ER", cust: "Daniel Jaramilo", city: "WOODSTOCK", model: "DOP48M96DLS", note: "LT 5/15 ETD 6/21", mfg: "", irKit: "", type: "SMS", branch: "", tech: "Daven Hodge", contact: "", pref: "Y", sched: "", status: "CL-Parts Back Ordered", delay: 7, phone: "210.639.1775", redo: "Y", aging: 7, calls: 0, diag: "Y", partOrder: "Part Ordered", created: "05/11/26" },
          { no: "1007153963-101", wty: "IW", acct: "GSL00002", cust: "Fred Evans", city: "LOCUST GROVE", model: "FCRG3062AS", note: "ETA 05/18", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "", contact: "", pref: "Y", sched: "05/13/26", status: "CSR-Left Message for Cx", delay: 7, phone: "404.565.6438", redo: "Y", aging: 7, calls: 1, diag: "Y", partOrder: "Part Ordered", created: "05/11/26" },
          { no: "1007153025-102", wty: "IW", acct: "GSL00002", cust: "Chelsea Stinson", city: "GOOD HOPE", model: "FRSS2323AW", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Joshua Silva", contact: "", pref: "N", sched: "05/14/26", status: "OP-UPDATE HOLD", delay: 7, phone: "904.610.8339", redo: "N", aging: 7, calls: 0, diag: "N", partOrder: "Not Diagnosed", created: "05/11/26" },
          { no: "1007143353-101", wty: "IW", acct: "GSL00002", cust: "Chris Edmondson", city: "JACKSON", model: "FRUF2020AN", note: "WF 05/15 waiting parts", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Joshua Silva", contact: "", pref: "Y", sched: "05/13/26", status: "OP-Waiting for Part", delay: 7, phone: "678.209.8563", redo: "Y", aging: 7, calls: 0, diag: "Y", partOrder: "Part Ordered", created: "05/11/26" },
          { no: "SA-33596291", wty: "IW", acct: "GSL00002", cust: "Sarah Thomason", city: "BALL GROUND", model: "GDT670SYV8FS", note: "Case 22926354 ORDER 1067447378", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Abraham Im", contact: "", pref: "Y", sched: "05/12/26", status: "CL-Parts Back Ordered", delay: 7, phone: "727.515.6620", redo: "Y", aging: 7, calls: 0, diag: "Y", partOrder: "", created: "05/11/26" },
          { no: "SA-33643491", wty: "IW", acct: "GSL00002", cust: "Ronnie Deese", city: "TALLAPOOSA", model: "PDT715SYV6FS", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Abel Severino", contact: "", pref: "N", sched: "05/15/26", status: "TR-Need Triage", delay: 7, phone: "770.841.6726", redo: "N", aging: 7, calls: 0, diag: "N", partOrder: "Not Diagnosed", created: "05/11/26" },
          { no: "SA-33776671", wty: "IW", acct: "GSL00002", cust: "Melissa Kaya", city: "ACWORTH", model: "PEP7030DT1BB", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Gerrell Berg", contact: "", pref: "Y", sched: "05/21/26", status: "OP-Waiting for Part", delay: 7, phone: "470.723.9848", redo: "Y", aging: 7, calls: 0, diag: "Y", partOrder: "Part Ordered", created: "05/11/26" },
          { no: "SA-33646571", wty: "IW", acct: "GSL00002", cust: "Ronnie Deese", city: "TALLAPOOSA", model: "PXD22BYPDFS", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Abel Severino", contact: "", pref: "N", sched: "05/15/26", status: "TR-Need Triage", delay: 7, phone: "770.841.6726", redo: "N", aging: 7, calls: 0, diag: "N", partOrder: "Not Diagnosed", created: "05/11/26" },
          { no: "26000647878DF1", wty: "IW", acct: "GSL00002", cust: "Lorraine Lobos", city: "GAINESVILLE", model: "RF29BB8600QLAA", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "", contact: "", pref: "Y", sched: "05/13/26", status: "TR-Need PO", delay: 7, phone: "404.599.3255", redo: "Y", aging: 7, calls: 0, diag: "Y", partOrder: "", created: "05/11/26" },
          { no: "498078311", wty: "IW", acct: "GSL00002", cust: "Billy Akins", city: "CARTERSVILLE", model: "WRF767SDHZ", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Jordan Brown", contact: "", pref: "Y", sched: "05/13/26", status: "OP-Waiting for Part", delay: 7, phone: "980.328.9460", redo: "Y", aging: 7, calls: 0, diag: "Y", partOrder: "Part Ordered", created: "05/11/26" },
          { no: "SA-33466591", wty: "IW", acct: "GSL00002", cust: "Susan Garcia", city: "ACWORTH", model: "HPS10LGVRBB", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Jordan Brown", contact: "", pref: "Y", sched: "05/13/26", status: "CSR-Needs Scheduling", delay: 10, phone: "404.323.0419", redo: "Y", aging: 10, calls: 0, diag: "Y", partOrder: "Part Ordered", created: "05/08/26" },
          { no: "26000640263DF1", wty: "IW", acct: "GSL00002", cust: "Pamela Dupree", city: "ARAGON", model: "WA44A3205A", note: "KU follow up for cheaper dampers", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Jordan Brown", contact: "", pref: "Y", sched: "05/13/26", status: "OP-Waiting for Part", delay: 10, phone: "770.899.2727", redo: "Y", aging: 10, calls: 0, diag: "Y", partOrder: "", created: "05/08/26" },
          { no: "SA-33224951", wty: "CLPW", acct: "GSL00002", cust: "Eugene Griffin", city: "TAYLORSVILLE", model: "PFQ97HSPVDS", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Joshua Silva", contact: "", pref: "N", sched: "05/14/26", status: "OP-UPDATE HOLD", delay: 11, phone: "404.406.5419", redo: "N", aging: 11, calls: 2, diag: "N", partOrder: "Not Diagnosed", created: "05/07/26" },
          { no: "SA-33319261", wty: "IW", acct: "GSL00002", cust: "Dianne Bishop", city: "CANTON", model: "PTW605BSRWS", note: "Assign to Gerrell", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Gerrell Berg", contact: "", pref: "Y", sched: "05/11/26", status: "CSR-Needs Scheduling", delay: 11, phone: "770.891.3125", redo: "Y", aging: 11, calls: 1, diag: "Y", partOrder: "Part Ordered", created: "05/07/26" },
          { no: "26000635951DF1", wty: "IW", acct: "GSL00002", cust: "Jeni Davis", city: "WINSTON", model: "WFW5620HW", note: "KU waiting for update", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Abel Severino", contact: "", pref: "Y", sched: "05/11/26", status: "CSR-Needs Scheduling", delay: 11, phone: "770.653.0482", redo: "Y", aging: 11, calls: 0, diag: "Y", partOrder: "Part Ordered", created: "05/07/26" },
          { no: "26000638416DF1", wty: "IW", acct: "GSL00002", cust: "Lisa Bailey", city: "VILLA RICA", model: "WT7005CW", note: "WF 05/15 waiting parts", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Abel Severino", contact: "", pref: "Y", sched: "05/12/26", status: "OP-Waiting for Part", delay: 11, phone: "404.452.6929", redo: "Y", aging: 11, calls: 0, diag: "Y", partOrder: "Part Ordered", created: "05/07/26" },
          { no: "SA-33171622", wty: "IW", acct: "GSL00002", cust: "Lisa Brewer", city: "CANTON", model: "GDF550PGRBB", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Gerrell Berg", contact: "", pref: "N", sched: "05/08/26", status: "CSR-Needs Scheduling", delay: 12, phone: "404.862.1237", redo: "N", aging: 12, calls: 1, diag: "N", partOrder: "Not Diagnosed", created: "05/06/26" },
          { no: "26000633099DF1", wty: "IW", acct: "GSL00002", cust: "Cara Korom", city: "BALDWIN", model: "MED7230HC", note: "PA SUB 05/15 - SBM consult", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Gerrell Berg", contact: "", pref: "Y", sched: "05/08/26", status: "CL-Parts Back Ordered", delay: 12, phone: "770.820.1243", redo: "Y", aging: 12, calls: 0, diag: "Y", partOrder: "", created: "05/06/26" },
          { no: "SA-32862182", wty: "IW", acct: "GSL00002", cust: "Joe Wahn", city: "ATLANTA", model: "CTD70DP2N5S1", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Abraham Im", contact: "", pref: "Y", sched: "05/07/26", status: "TR-Need Triage", delay: 13, phone: "404.858.7390", redo: "Y", aging: 13, calls: 0, diag: "Y", partOrder: "Part Ordered", created: "05/05/26" },
          { no: "SA-32984361", wty: "IW", acct: "GSL00002", cust: "James Upshaw", city: "CARTERSVILLE", model: "JVM3162RJSS", note: "WF 05/13 tech follow up", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Gerrell Berg", contact: "", pref: "N", sched: "05/08/26", status: "OP-UPDATE HOLD", delay: 13, phone: "770.722.5010", redo: "N", aging: 13, calls: 1, diag: "N", partOrder: "Not Diagnosed", created: "05/05/26" },
          { no: "SA-32707502", wty: "IW", acct: "GSL00002", cust: "Neal Market", city: "GREENSBORO", model: "PXD22BYPBFS", note: "", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Joshua Silva", contact: "", pref: "Y", sched: "05/07/26", status: "CSR-Needs Scheduling", delay: 14, phone: "706.817.2900", redo: "Y", aging: 14, calls: 1, diag: "Y", partOrder: "Partially Ordered", created: "05/04/26" },
          { no: "3844719E11", wty: "IW", acct: "GSL00002", cust: "Laura Brennan", city: "WOODSTOCK", model: "RBIV-36", note: "WF 05/15 waiting parts ETA", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Abraham Im", contact: "", pref: "N", sched: "05/06/26", status: "OP-Waiting for Part", delay: 14, phone: "404.372.3793", redo: "N", aging: 14, calls: 0, diag: "N", partOrder: "Not Diagnosed", created: "05/04/26" },
          { no: "SA-32236223", wty: "IW", acct: "GSL00002", cust: "Brian Gokey", city: "Cartersville", model: "CES700P2M5S1", note: "ETA 05/12", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Joshua Silva", contact: "", pref: "Y", sched: "05/04/26", status: "OP-UPDATE HOLD", delay: 18, phone: "678.928.1284", redo: "Y", aging: 18, calls: 1, diag: "Y", partOrder: "Partially Ordered", created: "04/30/26" },
          { no: "1006996918-112", wty: "IW", acct: "GSL00002", cust: "Elizabeth Prince", city: "ALPHARETTA", model: "PDSH4816BF0A", note: "WF 05/15 P4 waiting parts", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "", contact: "", pref: "Y", sched: "05/01/26", status: "OP-Waiting for Part", delay: 19, phone: "678.350.3012", redo: "Y", aging: 19, calls: 0, diag: "Y", partOrder: "Partially Ordered", created: "04/29/26" },
          { no: "SA-31905321", wty: "CLPW", acct: "GSL00002", cust: "Morgan Beck", city: "JASPER", model: "CWE23SP4MW2", note: "Part discontinued - BO", mfg: "", irKit: "", type: "SMS", branch: "", tech: "", contact: "", pref: "Y", sched: "05/01/26", status: "OP-Waiting for Part", delay: 20, phone: "706.669.8417", redo: "Y", aging: 20, calls: 0, diag: "Y", partOrder: "Partially Ordered", created: "04/28/26" },
          { no: "1006996058-103", wty: "IW", acct: "GSL00002", cust: "Kim Robbins", city: "WINTERVILLE", model: "GRMS2773AF", note: "WF 05/15 waiting parts", mfg: "IH", irKit: "", type: "SMS", branch: "", tech: "Jordan Brown", contact: "", pref: "Y", sched: "04/30/26", status: "OP-Waiting for Part", delay: 20, phone: "706.726.9188", redo: "Y", aging: 20, calls: 1, diag: "Y", partOrder: "Partially Ordered", created: "04/28/26" },
          { no: "4004939472", wty: "IW", acct: "ER", cust: "Stacy Clark", city: "WALESKA", model: "MRQ22D7AST", note: "Parts shipped to BM - resend needed", mfg: "", irKit: "", type: "SMS", branch: "", tech: "Gerrell Berg", contact: "", pref: "Y", sched: "05/13/26", status: "OP-UPDATE HOLD", delay: 20, phone: "404.844.9851", redo: "Y", aging: 20, calls: 1, diag: "Y", partOrder: "Part Ordered", created: "04/28/26" },
          { no: "SNWV44E2BCC6-22", wty: "XW", acct: "1276506820", cust: "Patricia Harper", city: "SPARTA", model: "WT7405CV", note: "Area too far - SBM coordination", mfg: "", irKit: "", type: "Phone", branch: "", tech: "", contact: "", pref: "Y", sched: "", status: "CSR-Left Message for Cx", delay: 24, phone: "706.444.5623", redo: "Y", aging: 24, calls: 5, diag: "Y", partOrder: "Partially Ordered", created: "04/24/26" },
        ];
        return tickets[i] ? {
          ticketNo: tickets[i].no,
          warranty: tickets[i].wty,
          account: tickets[i].acct,
          customer: tickets[i].cust,
          city: tickets[i].city,
          location: "Atlanta",
          model: tickets[i].model,
          internalNote: tickets[i].note,
          manufacturer: tickets[i].mfg,
          irKit: tickets[i].irKit,
          type: tickets[i].type,
          branch: tickets[i].branch,
          technician: tickets[i].tech,
          contact: tickets[i].contact,
          customerPref: tickets[i].pref,
          schedule: tickets[i].sched,
          status: tickets[i].status,
          delay: tickets[i].delay,
          phone: tickets[i].phone,
          redo: tickets[i].redo,
          aging: tickets[i].aging,
          calls: tickets[i].calls,
          diagnosed: tickets[i].diag,
          partOrder: tickets[i].partOrder,
          created: tickets[i].created,
        } : {};
      },
      custom: "ticket-list" as const,
    },
    {
      slug: "new-ticket",
      title: "Create New Ticket",
      description: "Create and stage new service tickets.",
      fields: [
        { key: "ticketNo", label: "Ticket No", filterable: true },
        { key: "customer", label: "Customer", filterable: true },
        { key: "city", label: "City", filterable: true },
        { key: "technician", label: "Technician", type: "select", options: TECHS, editable: true, filterable: true },
        { key: "status", label: "Status", type: "select", options: ["New","Queued","Assigned","Hold"], editable: true, filterable: true },
        { key: "created", label: "Created", type: "date" },
      ],
      count: 18,
      seed: (i) => ({
        ticketNo: "NT-" + pad(40000 + i),
        customer: pick(CUSTOMERS, i),
        city: pick(CITIES, i),
        technician: pick(TECHS, i),
        status: pick(["New","Queued","Assigned","Hold"], i),
        created: dateStr(-(i % 20)),
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
      description: "Complete ticket details for in-progress and pending actions.",
      fields: [
        { key: "ticketNo", label: "Ticket No", filterable: true },
        { key: "warranty", label: "Warranty", type: "select", options: ["IW","OW","XW","CLPW"], filterable: true },
        { key: "account", label: "Account", filterable: true },
        { key: "customer", label: "Customer", filterable: true },
        { key: "city", label: "City", filterable: true },
        { key: "location", label: "Location", type: "select", options: ["Atlanta","Other"], filterable: true },
        { key: "model", label: "Model", filterable: true },
        { key: "internalNote", label: "Internal Note", editable: true },
        { key: "manufacturer", label: "Manufacturer", filterable: true },
        { key: "irKit", label: "IR Kit", editable: true },
        { key: "type", label: "Type", type: "select", options: ["SMS","OSR","Phone"], filterable: true },
        { key: "branch", label: "Branch", filterable: true },
        { key: "technician", label: "Technician", type: "select", options: TECHS, editable: true, filterable: true },
        { key: "contact", label: "Contact", filterable: true },
        { key: "customerPref", label: "Cx Prefer", type: "select", options: ["Y","N"], editable: true },
        { key: "schedule", label: "Schedule", type: "date", editable: true },
        { key: "status", label: "Status", type: "select", options: ["CSR-Assigned to ASC","OP-Waiting for Part","TR-Need Triage","CSR-Needs Scheduling","CSR-Left Message for Cx","OP-UPDATE HOLD","TR-Need PO","CL-Parts Back Ordered"], filterable: true, editable: true },
        { key: "delay", label: "Delay", type: "number", editable: true },
        { key: "phone", label: "Phone", filterable: true },
        { key: "redo", label: "Redo", type: "select", options: ["Y","N"], editable: true },
        { key: "aging", label: "Aging", type: "number" },
        { key: "calls", label: "Calls", type: "number" },
        { key: "diagnosed", label: "Diagnosed", type: "select", options: ["Y","N"], editable: true },
        { key: "partOrder", label: "Part Order", type: "select", options: ["Not Diagnosed","Part Ordered","Partially Ordered",""] , editable: true, filterable: true },
        { key: "created", label: "Created", type: "date" },
      ],
      count: 50,
      seed: (i) => ({
        ticketNo: "TD-" + pad(50000 + i),
        warranty: pick(["IW","OW","XW","CLPW"], i),
        account: pick(ACCOUNTS, i),
        customer: pick(CUSTOMERS, i),
        city: pick(CITIES, i),
        location: pick(["Atlanta","Other"], i),
        model: pick(APPLIANCES, i),
        internalNote: ["Awaiting part", "Callback needed", "Quote pending", ""][i % 4],
        manufacturer: pick(["IH","WF","GE","LG"], i),
        irKit: i % 3 === 0 ? "Yes" : "",
        type: pick(["SMS","OSR","Phone"], i),
        branch: pick(BRANCHES, i),
        technician: pick(TECHS, i),
        contact: "",
        customerPref: pick(["Y","N"], i),
        schedule: dateStr(i % 12),
        status: pick(["CSR-Assigned to ASC","OP-Waiting for Part","TR-Need Triage","CSR-Needs Scheduling","CSR-Left Message for Cx","OP-UPDATE HOLD","TR-Need PO","CL-Parts Back Ordered"], i),
        delay: i % 15,
        phone: `555-010${i % 10}`,
        redo: pick(["Y","N"], i),
        aging: i % 20,
        calls: i % 4,
        diagnosed: pick(["Y","N"], i),
        partOrder: pick(["Not Diagnosed","Part Ordered","Partially Ordered",""] , i),
        created: dateStr(-(i % 25)),
      }),
    },
    {
      slug: "work-planner",
      title: "Daily Schedule",
      description: "Plan technician assignments and task sequences.",
      fields: [
        { key: "date", label: "Date", type: "date", filterable: true },
        { key: "tech", label: "Tech", type: "select", options: TECHS, filterable: true },
        { key: "ticketNo", label: "Ticket No", filterable: true },
        { key: "task", label: "Task", editable: true },
        { key: "priority", label: "Priority", type: "select", options: PRIORITY, filterable: true },
        { key: "status", label: "Status", type: "select", options: ["Planned","In Progress","Complete","Blocked"], editable: true, filterable: true },
      ],
      count: 24,
      seed: (i) => ({
        date: dateStr((i % 14) - 2),
        tech: pick(TECHS, i),
        ticketNo: "TP-" + pad(60000 + i),
        task: ["Morning route","Parts pickup","Follow-up call","Inventory check","Return processing"][i % 5],
        priority: pick(PRIORITY, i),
        status: pick(["Planned","In Progress","Complete","Blocked"], i),
      }),
    },
    {
      slug: "work-calendar",
      title: "Work Calendar (Monthly)",
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
      custom: "work-map",
      fields: [
        { key: "id", label: "Ticket #", filterable: true },
        { key: "city", label: "City", type: "select", options: CITIES, filterable: true },
        { key: "address", label: "Address" },
        { key: "tech", label: "Tech", type: "select", options: TECHS, filterable: true },
        { key: "appliance", label: "Service", type: "select", options: APPLIANCES },
        { key: "location", label: "Location" },
        { key: "technician", label: "Technician", type: "select", options: TECHS },
        { key: "status", label: "Status", type: "select", options: STATUS, filterable: true },
        { key: "priority", label: "Priority", type: "select", options: PRIORITY, filterable: true },
        { key: "eta", label: "ETA" },
      ],
      seed: (i) => ({
        id: "T-" + pad(20000 + i),
        city: pick(CITIES, i),
        location: pick(CITIES, i),
        address: `${100 + i*11} Main St`,
        tech: pick(TECHS, i),
        appliance: pick(APPLIANCES, i),
        technician: pick(TECHS, i),
        status: pick(STATUS, i),
        priority: pick(PRIORITY, i),
        eta: `${8 + (i%9)}:${i%2 ? "30" : "00"} ${i%9 < 4 ? "AM" : "PM"}`,
      }),
    },
  ],
};

// --- Reports ---
const CLAIM_LOCATIONS = ["Asheville","Atlanta","Birmingham","Cape Girardeau","Chattanooga","Columbus","Dallas","Destin","Huntsville","Jackson,MS","Jackson,TN","Jacksonville","Jonesboro","Knoxville","Lake Charles","Little Rock","Louisville","Memphis","Mobile","Montgomery","Nashville","Norfolk","Richmond","San Antonio","St. Louis"];
const CLAIM_COMPANIES = ["Samsung","LG","Whirlpool","GE Appliances","Bosch","Electrolux"];
const CLAIM_TYPES = ["In-Home Repair","Parts Replacement","Warranty Exchange","Service Refund","Labor Claim"];
const CLAIM_STATUSES = ["Ready to Complete","Cancelled","Claimed","Pending","Denied","Approved"];

const claimsMod: ModuleDef = {
  slug: "claims",
  label: "Claims",
  tagline: "Claims pipeline and approvals",
  accent: "#f59e0b",
  submodules: [
    {
      slug: "need-claim-list",
      title: "Need Claim List",
      description: "Tickets completed or cancelled that need claim submission.",
      custom: "need-claim-list" as any,
      fields: [
        { key: "ticketNo", label: "Ticket No", filterable: true },
        { key: "location", label: "Location", type: "select", options: CLAIM_LOCATIONS, filterable: true },
        { key: "completedDate", label: "Completed/Cancelled", type: "date", filterable: true },
        { key: "status", label: "Status", type: "select", options: CLAIM_STATUSES, filterable: true },
        { key: "tech", label: "Technician", type: "select", options: TECHS, filterable: true },
        { key: "customer", label: "Customer", filterable: true },
        { key: "appliance", label: "Appliance", type: "select", options: APPLIANCES, filterable: true },
        { key: "claimCompany", label: "Claim Company", type: "select", options: CLAIM_COMPANIES, filterable: true },
        { key: "amount", label: "Amount", type: "number" },
      ],
      count: 40,
      seed: (i) => ({
        ticketNo: "TK-2026-" + pad(1000 + i),
        location: pick(CLAIM_LOCATIONS, i),
        completedDate: dateStr(-(i % 90)),
        status: pick(CLAIM_STATUSES, i),
        tech: pick(TECHS, i),
        customer: pick(CUSTOMERS, i),
        appliance: pick(APPLIANCES, i),
        claimCompany: pick(CLAIM_COMPANIES, i),
        amount: 80 + (i * 37) % 600,
      }),
    },
    {
      slug: "claim-list",
      title: "Claim List",
      description: "Full list of submitted claims with current status.",
      custom: "claim-list" as any,
      fields: [
        { key: "claimNo", label: "Claim No", filterable: true },
        { key: "ticketNo", label: "Ticket No", filterable: true },
        { key: "location", label: "Location", type: "select", options: CLAIM_LOCATIONS, filterable: true },
        { key: "claimCompany", label: "Claim Company", type: "select", options: CLAIM_COMPANIES, filterable: true },
        { key: "claimType", label: "Claim Type", type: "select", options: CLAIM_TYPES, filterable: true },
        { key: "submittedDate", label: "Submitted", type: "date", filterable: true },
        { key: "stage", label: "Stage", type: "select", options: ["Submitted","Review","Approved","Denied","Paid"], filterable: true },
        { key: "amount", label: "Amount", type: "number" },
      ],
      count: 35,
      seed: (i) => ({
        claimNo: "CLM-" + pad(90000 + i),
        ticketNo: "TK-2026-" + pad(1000 + i),
        location: pick(CLAIM_LOCATIONS, i),
        claimCompany: pick(CLAIM_COMPANIES, i),
        claimType: pick(CLAIM_TYPES, i),
        submittedDate: dateStr(-(i % 60)),
        stage: pick(["Submitted","Review","Approved","Denied","Paid"], i),
        amount: 100 + (i * 43) % 900,
      }),
    },
    {
      slug: "authorization-status",
      title: "Authorization Status",
      description: "Track authorization requests and approval status.",
      custom: "authorization-status" as any,
      fields: [
        { key: "authNo", label: "Auth No", filterable: true },
        { key: "ticketNo", label: "Ticket No", filterable: true },
        { key: "location", label: "Location", type: "select", options: CLAIM_LOCATIONS, filterable: true },
        { key: "claimCompany", label: "Claim Company", type: "select", options: CLAIM_COMPANIES, filterable: true },
        { key: "requestedDate", label: "Requested", type: "date", filterable: true },
        { key: "status", label: "Status", type: "select", options: ["Pending","Approved","Denied","Expired"], filterable: true },
        { key: "approvedAmount", label: "Approved $", type: "number" },
      ],
      count: 25,
      seed: (i) => ({
        authNo: "AUTH-" + pad(5000 + i),
        ticketNo: "TK-2026-" + pad(1000 + i),
        location: pick(CLAIM_LOCATIONS, i),
        claimCompany: pick(CLAIM_COMPANIES, i),
        requestedDate: dateStr(-(i % 45)),
        status: pick(["Pending","Approved","Denied","Expired"], i),
        approvedAmount: i % 4 === 2 ? 0 : 75 + (i * 29) % 700,
      }),
    },
    {
      slug: "claim-calendar-weekly",
      title: "Claim Calendar (Weekly)",
      description: "Weekly calendar view of scheduled claim activities.",
      custom: "claim-calendar-weekly" as any,
      fields: [
        { key: "week", label: "Week", filterable: true },
        { key: "location", label: "Location", type: "select", options: CLAIM_LOCATIONS, filterable: true },
        { key: "claimCompany", label: "Claim Company", type: "select", options: CLAIM_COMPANIES, filterable: true },
        { key: "scheduledDate", label: "Scheduled", type: "date", filterable: true },
        { key: "activity", label: "Activity", type: "select", options: ["Inspection","Repair","Follow-Up","Submission","Approval Call"], filterable: true },
        { key: "tech", label: "Tech", type: "select", options: TECHS, filterable: true },
      ],
      count: 20,
      seed: (i) => ({
        week: `W${(i % 8) + 1}`,
        location: pick(CLAIM_LOCATIONS, i),
        claimCompany: pick(CLAIM_COMPANIES, i),
        scheduledDate: dateStr(i % 30),
        activity: pick(["Inspection","Repair","Follow-Up","Submission","Approval Call"], i),
        tech: pick(TECHS, i),
      }),
    },
    {
      slug: "claim-planner",
      title: "Claim Planner",
      description: "Plan and schedule upcoming claim submissions and follow-ups.",
      custom: "claim-planner" as any,
      fields: [
        { key: "claimNo", label: "Claim No", filterable: true },
        { key: "location", label: "Location", type: "select", options: CLAIM_LOCATIONS, filterable: true },
        { key: "plannedDate", label: "Planned Date", type: "date", filterable: true },
        { key: "priority", label: "Priority", type: "select", options: PRIORITY, filterable: true },
        { key: "assignedTo", label: "Assigned To", type: "select", options: TECHS, filterable: true },
        { key: "notes", label: "Notes", editable: true },
      ],
      count: 20,
      seed: (i) => ({
        claimNo: "CLM-" + pad(90000 + i),
        location: pick(CLAIM_LOCATIONS, i),
        plannedDate: dateStr(i % 21),
        priority: pick(PRIORITY, i),
        assignedTo: pick(TECHS, i),
        notes: pick(["Awaiting parts","Customer confirmed","Parts ordered","Needs callback","Ready to submit"], i),
      }),
    },

    {
      slug: "claim-calendar-monthly",
      title: "Claim Calendar (Monthly)",
      description: "Monthly calendar view of claim activities by location.",
      custom: "claim-calendar-monthly" as any,
      fields: [
        { key: "month", label: "Month", filterable: true },
        { key: "location", label: "Location", type: "select", options: CLAIM_LOCATIONS, filterable: true },
        { key: "count", label: "Claim Count", type: "number" },
      ],
      count: 12,
      seed: (i) => ({
        month: `2026-${String(i+1).padStart(2,"0")}`,
        location: pick(CLAIM_LOCATIONS, i),
        count: 50 + (i * 23) % 200,
      }),
    },
    {
      slug: "credit-card-report",
      title: "Credit Card Report",
      description: "Credit card transaction report for claims.",
      custom: "credit-card-report" as any,
      fields: [
        { key: "location", label: "Location", type: "select", options: CLAIM_LOCATIONS, filterable: true },
        { key: "transDate", label: "Transaction Date", type: "date", filterable: true },
        { key: "amount", label: "Amount", type: "number" },
        { key: "status", label: "Status", type: "select", options: ["Approved","Declined","Pending"], filterable: true },
      ],
      count: 30,
      seed: (i) => ({
        location: pick(CLAIM_LOCATIONS, i),
        transDate: dateStr(-(i % 30)),
        amount: 50 + (i * 27) % 800,
        status: pick(["Approved","Declined","Pending"], i),
      }),
    },
    {
      slug: "encompass-claim-audit",
      title: "Encompass Claim Audit Report",
      description: "Encompass claim audit and reconciliation report.",
      fields: [
        { key: "claimNo", label: "Claim No", filterable: true },
        { key: "location", label: "Location", type: "select", options: CLAIM_LOCATIONS, filterable: true },
        { key: "auditDate", label: "Audit Date", type: "date", filterable: true },
        { key: "status", label: "Status", type: "select", options: ["Pass","Fail","Pending Review"], filterable: true },
        { key: "amount", label: "Amount", type: "number" },
      ],
      count: 25,
      seed: (i) => ({
        claimNo: "CLM-" + pad(90000 + i),
        location: pick(CLAIM_LOCATIONS, i),
        auditDate: dateStr(-(i % 30)),
        status: pick(["Pass","Fail","Pending Review"], i),
        amount: 100 + (i * 31) % 900,
      }),
    },
    {
      slug: "monthly-part-report",
      title: "Monthly Part Report",
      description: "Monthly parts usage and claim correlation report.",
      fields: [
        { key: "month", label: "Month", filterable: true },
        { key: "location", label: "Location", type: "select", options: CLAIM_LOCATIONS, filterable: true },
        { key: "partNo", label: "Part No", filterable: true },
        { key: "qty", label: "Qty", type: "number" },
        { key: "totalCost", label: "Total Cost", type: "number" },
      ],
      count: 30,
      seed: (i) => ({
        month: `2026-${String((i%5)+1).padStart(2,"0")}`,
        location: pick(CLAIM_LOCATIONS, i),
        partNo: "PT-" + pad(70000 + i),
        qty: 1 + (i % 8),
        totalCost: 50 + (i * 19) % 500,
      }),
    },
    {
      slug: "payroll-report",
      title: "Payroll Report",
      description: "Technician payroll summary for claim-related work.",
      fields: [
        { key: "tech", label: "Technician", type: "select", options: TECHS, filterable: true },
        { key: "location", label: "Location", type: "select", options: CLAIM_LOCATIONS, filterable: true },
        { key: "payPeriod", label: "Pay Period", filterable: true },
        { key: "hoursWorked", label: "Hours", type: "number" },
        { key: "grossPay", label: "Gross Pay", type: "number" },
      ],
      count: 25,
      seed: (i) => ({
        tech: pick(TECHS, i),
        location: pick(CLAIM_LOCATIONS, i),
        payPeriod: `2026-W${String(10+(i%15)).padStart(2,"0")}`,
        hoursWorked: 35 + (i % 10),
        grossPay: 800 + (i * 37) % 1200,
      }),
    },
    {
      slug: "unclaimed-parts-report",
      title: "Unclaimed Parts Report",
      description: "Parts used in tickets not yet included in a claim.",
      fields: [
        { key: "ticketNo", label: "Ticket No", filterable: true },
        { key: "location", label: "Location", type: "select", options: CLAIM_LOCATIONS, filterable: true },
        { key: "partNo", label: "Part No", filterable: true },
        { key: "usedDate", label: "Used Date", type: "date", filterable: true },
        { key: "amount", label: "Amount", type: "number" },
        { key: "claimStatus", label: "Claim Status", type: "select", options: ["Unclaimed","In Review","Rejected"], filterable: true },
      ],
      count: 30,
      seed: (i) => ({
        ticketNo: "TK-2026-" + pad(1000 + i),
        location: pick(CLAIM_LOCATIONS, i),
        partNo: "PT-" + pad(70000 + i),
        usedDate: dateStr(-(i % 60)),
        amount: 40 + (i * 23) % 400,
        claimStatus: pick(["Unclaimed","In Review","Rejected"], i),
      }),
    },
    {
      slug: "repair-code-restriction",
      title: "(A) Repair Code Restriction",
      description: "Admin repair code restriction rules by claim company.",
      fields: [
        { key: "claimCompany", label: "Claim Company", type: "select", options: CLAIM_COMPANIES, filterable: true },
        { key: "repairCode", label: "Repair Code", filterable: true },
        { key: "restriction", label: "Restriction", filterable: true },
        { key: "effectiveDate", label: "Effective Date", type: "date" },
        { key: "active", label: "Active", type: "select", options: ["Yes","No"], filterable: true },
      ],
      count: 20,
      seed: (i) => ({
        claimCompany: pick(CLAIM_COMPANIES, i),
        repairCode: "RC-" + pad(1000 + i),
        restriction: pick(["Labor Only","Parts Only","Excluded","Preauth Required","Limit Applied"], i),
        effectiveDate: dateStr(-(i * 10) % 180),
        active: i % 3 === 0 ? "No" : "Yes",
      }),
    },
    {
      slug: "sales-summary-report",
      title: "(A) Sales Summary Report",
      description: "Admin sales summary for claim revenue and performance.",
      fields: [
        { key: "location", label: "Location", type: "select", options: CLAIM_LOCATIONS, filterable: true },
        { key: "month", label: "Month", filterable: true },
        { key: "totalClaims", label: "Total Claims", type: "number" },
        { key: "approvedAmount", label: "Approved $", type: "number" },
        { key: "paidAmount", label: "Paid $", type: "number" },
      ],
      count: 20,
      seed: (i) => ({
        location: pick(CLAIM_LOCATIONS, i),
        month: `2026-${String((i%5)+1).padStart(2,"0")}`,
        totalClaims: 20 + (i % 30),
        approvedAmount: 2000 + (i * 137) % 8000,
        paidAmount: 1800 + (i * 113) % 7000,
      }),
    },
    {
      slug: "tech-payroll-setup",
      title: "(A) Tech Payroll Setup",
      description: "Admin setup for technician payroll rates and rules.",
      fields: [
        { key: "tech", label: "Technician", type: "select", options: TECHS, filterable: true },
        { key: "location", label: "Location", type: "select", options: CLAIM_LOCATIONS, filterable: true },
        { key: "payType", label: "Pay Type", type: "select", options: ["Hourly","Commission","Salary","Per Job"], filterable: true },
        { key: "rate", label: "Rate", type: "number" },
        { key: "effectiveDate", label: "Effective Date", type: "date" },
        { key: "active", label: "Active", type: "select", options: ["Yes","No"], filterable: true },
      ],
      count: 15,
      seed: (i) => ({
        tech: pick(TECHS, i),
        location: pick(CLAIM_LOCATIONS, i),
        payType: pick(["Hourly","Commission","Per Job"], i),
        rate: 18 + (i * 3) % 30,
        effectiveDate: dateStr(-180),
        active: i % 8 === 0 ? "No" : "Yes",
      }),
    },
    {
      slug: "payment-report",
      title: "Payment Report",
      description: "Summary of claim payments received and pending.",
      fields: [
        { key: "claimNo", label: "Claim No", filterable: true },
        { key: "location", label: "Location", type: "select", options: CLAIM_LOCATIONS, filterable: true },
        { key: "claimCompany", label: "Claim Company", type: "select", options: CLAIM_COMPANIES, filterable: true },
        { key: "paymentDate", label: "Payment Date", type: "date", filterable: true },
        { key: "invoiceAmount", label: "Invoice $", type: "number" },
        { key: "paidAmount", label: "Paid $", type: "number" },
        { key: "status", label: "Status", type: "select", options: ["Paid","Partial","Pending","Rejected"], filterable: true },
      ],
      count: 30,
      seed: (i) => ({
        claimNo: "CLM-" + pad(90000 + i),
        location: pick(CLAIM_LOCATIONS, i),
        claimCompany: pick(CLAIM_COMPANIES, i),
        paymentDate: i % 4 === 3 ? "" : dateStr(-(i % 60)),
        invoiceAmount: 120 + (i * 51) % 1100,
        paidAmount: i % 4 === 3 ? 0 : 100 + (i * 41) % 1000,
        status: pick(["Paid","Partial","Pending","Rejected"], i),
      }),
    },
    {
      slug: "closing-report",
      title: "(A) Closing Report",
      description: "Approved claim closing summary and documentation.",
      fields: [
        { key: "claimNo", label: "Claim No", filterable: true },
        { key: "location", label: "Location", type: "select", options: CLAIM_LOCATIONS, filterable: true },
        { key: "closedDate", label: "Closed Date", type: "date", filterable: true },
        { key: "claimCompany", label: "Claim Company", type: "select", options: CLAIM_COMPANIES, filterable: true },
        { key: "tech", label: "Tech", type: "select", options: TECHS, filterable: true },
        { key: "approvedAmount", label: "Approved $", type: "number" },
        { key: "outcome", label: "Outcome", type: "select", options: ["Approved","Partial Approval","Escalated"], filterable: true },
      ],
      count: 25,
      seed: (i) => ({
        claimNo: "CLM-" + pad(90000 + i),
        location: pick(CLAIM_LOCATIONS, i),
        closedDate: dateStr(-(i % 60)),
        claimCompany: pick(CLAIM_COMPANIES, i),
        tech: pick(TECHS, i),
        approvedAmount: 100 + (i * 47) % 1200,
        outcome: pick(["Approved","Partial Approval","Escalated"], i),
      }),
    },
    {
      slug: "repair-status-report",
      title: "(R) Repair Status Report",
      description: "Repair claim outcomes and current repair status tracking.",
      fields: [
        { key: "ticketNo", label: "Ticket No", filterable: true },
        { key: "location", label: "Location", type: "select", options: CLAIM_LOCATIONS, filterable: true },
        { key: "tech", label: "Tech", type: "select", options: TECHS, filterable: true },
        { key: "appliance", label: "Appliance", type: "select", options: APPLIANCES, filterable: true },
        { key: "repairDate", label: "Repair Date", type: "date", filterable: true },
        { key: "repairStatus", label: "Repair Status", type: "select", options: ["In Progress","Completed","Waiting Parts","Cancelled","Redo"], filterable: true },
        { key: "claimStatus", label: "Claim Status", type: "select", options: ["Not Claimed","Pending","Approved","Denied"], filterable: true },
      ],
      count: 30,
      seed: (i) => ({
        ticketNo: "TK-2026-" + pad(1000 + i),
        location: pick(CLAIM_LOCATIONS, i),
        tech: pick(TECHS, i),
        appliance: pick(APPLIANCES, i),
        repairDate: dateStr(-(i % 45)),
        repairStatus: pick(["In Progress","Completed","Waiting Parts","Cancelled","Redo"], i),
        claimStatus: pick(["Not Claimed","Pending","Approved","Denied"], i),
      }),
    },
  ],
};

const BRANCHES_RPT = ["Houston HQ","Dallas","Austin","San Antonio","Memphis","Atlanta"];
const WARRANTY_TYPES = ["In-warranty","Out-of-warranty"];

const reportMod: ModuleDef = {
  slug: "report",
  label: "Report",
  tagline: "Operational, parts & technician reporting",
  accent: "#34d399",
  submodules: [
    {
      slug: "report-csr-daily",
      title: "CSR Daily Report",
      description: "CSR agent performance — tasks, schedule, attempts, mistakes.",
      custom: "report-csr-daily" as any,
      fields: [],
      count: 0,
      seed: () => ({}),
    },
    {
      slug: "report-claims-daily",
      title: "Claims Daily Report",
      description: "Claims completed vs remaining, brand breakdown and pending types.",
      custom: "report-claims-daily" as any,
      fields: [],
      count: 0,
      seed: () => ({}),
    },
    {
      slug: "report-triage-daily",
      title: "Triage Daily Report",
      description: "Triage completed, remaining, staff and agent performance.",
      custom: "report-triage-daily" as any,
      fields: [],
      count: 0,
      seed: () => ({}),
    },
    {
      slug: "report-parts-daily",
      title: "Part Daily Report",
      description: "Parts staff performance — collections, RA, receives per branch.",
      custom: "report-parts-daily" as any,
      fields: [],
      count: 0,
      seed: () => ({}),
    },
    {
      slug: "report-operations-daily",
      title: "Operations Daily Report",
      description: "Operations staff tasks, mishandled tickets and pending details.",
      custom: "report-operations-daily" as any,
      fields: [],
      count: 0,
      seed: () => ({}),
    },
    {
      slug: "report-east-tx",
      title: "Eastern TX Daily Report",
      description: "Technician LTP, completion rates and branch metrics — Eastern region.",
      custom: "report-east-tx" as any,
      fields: [],
      count: 0,
      seed: () => ({}),
    },
    {
      slug: "report-west-tx",
      title: "Western TX Daily Report",
      description: "Technician LTP, completion rates and branch metrics — Western region.",
      custom: "report-west-tx" as any,
      fields: [],
      count: 0,
      seed: () => ({}),
    },
    {
      slug: "report-central-tx",
      title: "Central TX Daily Report",
      description: "Technician LTP, completion rates and branch metrics — Central region.",
      custom: "report-central-tx" as any,
      fields: [],
      count: 0,
      seed: () => ({}),
    },
  ],
};
// --- Admin ---

// --- Admin ---
const ROLES = ["Admin","Manager","Supervisor","Technician","Viewer"];
const DEPARTMENTS = ["Operations","Service","Parts","Sales","IT","Finance"];
const adminMod: ModuleDef = {
  slug: "admin",
  label: "Admin",
  tagline: "Users, roles, settings & audit",
  accent: "#f472b6",
  submodules: [
    {
      slug: "user-management",
      title: "User Management",
      description: "User accounts administration.",
      custom: "user-management" as const,
      fields: [
        { key: "userId", label: "User ID", filterable: true },
        { key: "name", label: "Name", filterable: true, editable: true },
        { key: "email", label: "Email", editable: true },
        { key: "role", label: "Role", type: "select", options: ROLES, editable: true, filterable: true },
        { key: "department", label: "Department", type: "select", options: DEPARTMENTS, editable: true, filterable: true },
        { key: "status", label: "Status", type: "select", options: ["Active","Inactive"], editable: true, filterable: true },
        { key: "lastLogin", label: "Last Login", type: "date" },
      ],
      count: 177,
      seed: (i) => {
        const name = pick(CUSTOMERS, i);
        return {
          userId: "U-" + pad(100 + i, 3),
          name,
          email: name.toLowerCase().replace(/[^a-z]/g, ".") + "@adminhub.io",
          role: pick(ROLES, i),
          department: pick(DEPARTMENTS, i),
          status: i % 5 === 0 ? "Inactive" : "Active",
          lastLogin: dateStr(-(i%30)),
        };
      },
    },
    {
      slug: "location-management",
      title: "Location Management",
      description: "Manage branch locations and part shipping addresses.",
      custom: "location-management" as const,
      fields: [],
      seed: () => ({}),
    },
    {
      slug: "add-branch",
      title: "Add Branch",
      description: "Drop a point on the map, pick a service radius, and record every zip code inside it.",
      custom: "add-branch" as any,
      fields: [],
      seed: () => ({}),
    },
    {
      slug: "account-management",
      title: "Account Management",
      description: "Store external service accounts used for parts ordering and technician mapping.",
      custom: "account-management" as const,
      fields: [],
      seed: () => ({}),
    },
    {
      slug: "internal-message-support",
      title: "Internal Message Support",
      description: "Discord-style employee chat and broadcast channels.",
      custom: "internal-message-support" as any,
      fields: [
        { key: "date", label: "Date", type: "date", filterable: true },
        { key: "sender", label: "Sender", type: "select", options: TECHS, filterable: true },
        { key: "recipient", label: "Recipient", type: "select", options: TECHS, filterable: true },
        { key: "subject", label: "Subject", filterable: true },
        { key: "status", label: "Status", type: "select", options: ["Sent","Read","Replied","Archived"], filterable: true },
      ],
      count: 20,
      seed: (i) => ({
        date: dateStr(-(i % 14)),
        sender: pick(TECHS, i),
        recipient: pick(TECHS, i + 1),
        subject: pick(["Parts ETA","Schedule Update","Customer Note","Escalation","Approval Needed"], i),
        status: pick(["Sent","Read","Replied","Archived"], i),
      }),
    },
    {
      slug: "repair-statuses",
      title: "Repair Statuses",
      description: "Manage repair status labels and display colors.",
      custom: "repair-statuses",
      fields: [
        { key: "id", label: "Status ID", filterable: true },
        { key: "status", label: "Status", filterable: true, editable: true },
        { key: "group", label: "Group", type: "select", options: ["Open","Working","Waiting","Complete","Closed"], filterable: true },
        { key: "color", label: "Color", editable: true },
        { key: "active", label: "Active", type: "select", options: ["Yes","No"], editable: true, filterable: true },
        { key: "updated", label: "Updated", type: "date" },
      ],
      count: 18,
      seed: (i) => {
        const statuses = [
          { status: "CSR-Assigned", group: "Open", color: "#2563eb", active: "Yes" },
          { status: "CSR-Needs Scheduling", group: "Open", color: "#0ea5e9", active: "Yes" },
          { status: "OP-Waiting for Part", group: "Waiting", color: "#f59e0b", active: "Yes" },
          { status: "OP-Ready for Service", group: "Working", color: "#22c55e", active: "Yes" },
          { status: "CL-Claimed", group: "Working", color: "#14b8a6", active: "Yes" },
          { status: "PT-Need PreAuthorization", group: "Waiting", color: "#8b5cf6", active: "Yes" },
          { status: "TR-Need PO", group: "Waiting", color: "#f97316", active: "Yes" },
          { status: "Complete", group: "Complete", color: "#16a34a", active: "Yes" },
          { status: "Closed", group: "Closed", color: "#6b7280", active: "Yes" },
          { status: "On Hold", group: "Working", color: "#eab308", active: "Yes" },
          { status: "Cancelled", group: "Closed", color: "#dc2626", active: "Yes" },
          { status: "Customer Contact", group: "Open", color: "#0284c7", active: "Yes" },
          { status: "Diagnostics", group: "Working", color: "#0891b2", active: "Yes" },
          { status: "Parts Pending", group: "Waiting", color: "#c084fc", active: "Yes" },
          { status: "In Transit", group: "Working", color: "#3b82f6", active: "Yes" },
          { status: "Refund Pending", group: "Complete", color: "#10b981", active: "No" },
          { status: "Escalated", group: "Working", color: "#ef4444", active: "Yes" },
          { status: "Archived", group: "Closed", color: "#9ca3af", active: "No" },
        ];
        const s = statuses[i % statuses.length];
        return {
          id: "RST-" + pad(100 + i),
          status: s.status,
          group: s.group,
          color: s.color,
          active: s.active,
          updated: dateStr(-(i % 30)),
        };
      },
    },
  ],
};


export const MODULES: ModuleDef[] = [dashboardMod, ticketsMod, partsMod, claimsMod, reportMod, adminMod];

export function getModule(slug: string) {
  return MODULES.find((m) => m.slug === slug);
}
export function getSubModule(modSlug: string, subSlug: string) {
  return getModule(modSlug)?.submodules.find((s) => s.slug === subSlug);
}

// Role-based dashboard submodule access
const ROLE_DASHBOARD_ACCESS: Record<string, string[]> = {
  "superadmin": ["daily-activity", "overall-status", "tech-ranking", "location-ranking", "ticket-stats", "login-stats", "accounting-dashboard"],
  "admin": ["daily-activity", "overall-status", "tech-ranking", "location-ranking", "ticket-stats", "login-stats", "accounting-dashboard"],
  "manager": ["daily-activity", "overall-status", "tech-ranking"],
  "finance": ["ticket-stats", "overall-status", "accounting-dashboard"],
  "hr": ["overall-status", "login-stats"],
  "csr": ["daily-activity", "overall-status"],
  "parts": ["daily-activity", "overall-status"],
  "technician": ["daily-activity"],
  "viewer": ["overall-status", "ticket-stats"],
};

export function getFilteredDashboardSubmodules(role: string | null | undefined): SubModuleDef[] {
  if (!role) return [];
  const dashboardMod = getModule("dashboard");
  if (!dashboardMod) return [];
  
  const allowedSlugs = ROLE_DASHBOARD_ACCESS[role.toLowerCase()] || [];
  return dashboardMod.submodules.filter((s) => allowedSlugs.includes(s.slug));
}

export const PART_RETURN_ACCOUNTS = ACCOUNTS;
export const PART_RETURN_REASONS = REASONS;
export const PART_RETURN_STATUSES = ["Pending Pickup","Picked Up","In Transit","Received","Credited","Rejected"];
export const PART_RETURN_TECHS = TECHS;
export const PART_RETURN_VENDORS = ["Encompass","Marcone"];
