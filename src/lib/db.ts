import Dexie, { type Table } from "dexie";

// Types
export interface Part {
  id?: number;
  sku: string;
  name: string;
  category: string;
  quantity: number;
  unitPrice: number;
  vendor: string;
  warrantyMonths: number;
  status: "in-stock" | "low-stock" | "discontinued";
  createdAt?: Date;
}

export interface Ticket {
  id?: number;
  ticketNumber: string;
  title: string;
  description: string;
  status: "open" | "in-progress" | "resolved" | "closed";
  priority: "low" | "medium" | "high" | "critical";
  assignedTo: string;
  customer: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface Claim {
  id?: number;
  claimNumber: string;
  type: "warranty" | "return" | "damage" | "defect";
  description: string;
  amount: number;
  status: "pending" | "approved" | "rejected" | "paid";
  submittedBy: string;
  createdAt?: Date;
  approvedAt?: Date;
}

export interface Report {
  id?: number;
  name: string;
  type: "inventory" | "sales" | "performance" | "warranty";
  description: string;
  generatedAt: Date;
  data: Record<string, unknown>;
}

export interface User {
  id?: number;
  email: string;
  name: string;
  role: "admin" | "manager" | "technician" | "viewer";
  department: string;
  status: "active" | "inactive";
  createdAt?: Date;
}

// Dashboard Types
export interface TechRankingRecord {
  id?: number;
  rank: number;
  techName: string;
  office: string;
  thirtydayScore: number;
  tendayScore: number;
  dailyScores: Record<string, number>; // Date -> score mapping
  completions: number;
  redos: number;
}

export interface LocationRankingRecord {
  id?: number;
  rank: number;
  office: string;
  thirtydayScore: number;
  tendayScore: number;
  dailyScores: Record<string, number>; // Date -> score mapping
}

export interface TicketStatistic {
  id?: number;
  date: string;
  status: string;
  count: number;
  type: "monthly" | "daily";
}

export interface DashboardOverallStatus {
  id?: number;
  dateRange: { start: string; end: string };
  location: string;
  totalTickets: number;
  openTickets: number;
  inProgressTickets: number;
  resolvedTickets: number;
  closedTickets: number;
  pendingClaims: number;
  csrActivityCount: number;
}

// Database setup
export class AHSDatabase extends Dexie {
  parts!: Table<Part>;
  tickets!: Table<Ticket>;
  claims!: Table<Claim>;
  reports!: Table<Report>;
  users!: Table<User>;
  techRanking!: Table<TechRankingRecord>;
  locationRanking!: Table<LocationRankingRecord>;
  ticketStatistics!: Table<TicketStatistic>;
  overallStatus!: Table<DashboardOverallStatus>;

  constructor() {
    super("AdminHubSolutions");
    this.version(2).stores({
      parts: "++id, sku, category, status",
      tickets: "++id, ticketNumber, status, priority",
      claims: "++id, claimNumber, status, type",
      reports: "++id, type, generatedAt",
      users: "++id, email, role",
      techRanking: "++id, rank, office",
      locationRanking: "++id, rank, office",
      ticketStatistics: "++id, date, type",
      overallStatus: "++id, location",
    });
  }
}

export const db = new AHSDatabase();

// Initialize with dummy data
export async function initializeDummyData() {
  const hasData = await db.parts.count();
  if (hasData > 0) return; // Data already exists

  // Dummy Parts
  const parts: Part[] = [
    { sku: "PART-001", name: "Compressor Unit", category: "Mechanical", quantity: 45, unitPrice: 1250, vendor: "TechSupply Inc", warrantyMonths: 24, status: "in-stock" },
    { sku: "PART-002", name: "Hydraulic Pump", category: "Hydraulic", quantity: 12, unitPrice: 2100, vendor: "HydraFlow Ltd", warrantyMonths: 36, status: "low-stock" },
    { sku: "PART-003", name: "Control Board PCB", category: "Electronics", quantity: 156, unitPrice: 450, vendor: "ElectroTech Corp", warrantyMonths: 12, status: "in-stock" },
    { sku: "PART-004", name: "Pressure Valve", category: "Mechanical", quantity: 8, unitPrice: 890, vendor: "PressureSystems", warrantyMonths: 18, status: "low-stock" },
    { sku: "PART-005", name: "Cooling Radiator", category: "Thermal", quantity: 22, unitPrice: 680, vendor: "CoolTech Solutions", warrantyMonths: 24, status: "in-stock" },
  ];

  // Dummy Tickets
  const tickets: Ticket[] = [
    { ticketNumber: "TK-2026-001", title: "System Malfunction", description: "Client reports compressor not starting", status: "in-progress", priority: "high", assignedTo: "John Smith", customer: "Acme Corp", createdAt: new Date() },
    { ticketNumber: "TK-2026-002", title: "Maintenance Required", description: "Routine maintenance scheduled", status: "open", priority: "medium", assignedTo: "Sarah Johnson", customer: "Global Industries", createdAt: new Date() },
    { ticketNumber: "TK-2026-003", title: "Installation Support", description: "New equipment installation assistance", status: "open", priority: "medium", assignedTo: "Mike Wilson", customer: "Tech Ventures", createdAt: new Date() },
    { ticketNumber: "TK-2026-004", title: "Equipment Failure", description: "Hydraulic leak detected", status: "resolved", priority: "critical", assignedTo: "Bob Johnson", customer: "Industrial Works", createdAt: new Date() },
  ];

  // Dummy Claims
  const claims: Claim[] = [
    { claimNumber: "CL-2026-001", type: "warranty", description: "Device failed within warranty period", amount: 1500, status: "approved", submittedBy: "James Lee", createdAt: new Date() },
    { claimNumber: "CL-2026-002", type: "damage", description: "Shipping damage - bent components", amount: 800, status: "pending", submittedBy: "Emma Davis", createdAt: new Date() },
    { claimNumber: "CL-2026-003", type: "return", description: "Customer requested return", amount: 2100, status: "paid", submittedBy: "Mark Thompson", createdAt: new Date() },
    { claimNumber: "CL-2026-004", type: "defect", description: "Manufacturing defect found", amount: 450, status: "approved", submittedBy: "Lisa Anderson", createdAt: new Date() },
  ];

  // Dummy Reports
  const reports: Report[] = [
    { name: "May 2026 Inventory", type: "inventory", description: "Monthly inventory report", generatedAt: new Date(), data: { totalItems: 243, categories: 5, lowStockItems: 2 } },
    { name: "Q2 Sales Performance", type: "sales", description: "Quarterly sales metrics", generatedAt: new Date(), data: { totalRevenue: 125000, orders: 42, avgValue: 2976 } },
    { name: "Equipment Performance", type: "performance", description: "Equipment uptime and efficiency", generatedAt: new Date(), data: { uptime: 99.2, avgResponseTime: 125, efficiency: 94.5 } },
  ];

  // Dummy Users
  const users: User[] = [
    { email: "admin@ahsolutions.com", name: "Admin User", role: "admin", department: "Management", status: "active", createdAt: new Date() },
    { email: "manager@ahsolutions.com", name: "John Manager", role: "manager", department: "Operations", status: "active", createdAt: new Date() },
    { email: "tech@ahsolutions.com", name: "Tech Support", role: "technician", department: "Support", status: "active", createdAt: new Date() },
    { email: "viewer@ahsolutions.com", name: "Report Viewer", role: "viewer", department: "Finance", status: "active", createdAt: new Date() },
  ];

  // Dashboard: Tech Ranking Data (Sample from provided data)
  const techRankingRecords: TechRankingRecord[] = [
    { rank: 1, techName: "O Sylla", office: "Atlanta", thirtydayScore: 100.00, tendayScore: 100.00, dailyScores: { "04/18": 100 }, completions: 5, redos: 0 },
    { rank: 2, techName: "T Harper", office: "Huntsville", thirtydayScore: 100.00, tendayScore: 100.00, dailyScores: { "04/18": 100 }, completions: 4, redos: 0 },
    { rank: 3, techName: "Z Moradi", office: "Jacksonville", thirtydayScore: 64.00, tendayScore: 58.82, dailyScores: { "04/20": 83.33, "04/21": 50.00, "04/22": 20.00 }, completions: 18, redos: 2 },
    { rank: 4, techName: "D Nichols", office: "St. Louis", thirtydayScore: 60.12, tendayScore: 60.78, dailyScores: { "04/21": 55.56, "04/22": 66.67 }, completions: 16, redos: 1 },
    { rank: 5, techName: "B Zhang", office: "Nashville", thirtydayScore: 59.50, tendayScore: 60.53, dailyScores: { "04/20": 50.00, "04/21": 80.00 }, completions: 14, redos: 1 },
    { rank: 6, techName: "L Dowell", office: "Dallas", thirtydayScore: 59.22, tendayScore: 41.18, dailyScores: { "04/20": 12.50, "04/21": 100.00 }, completions: 15, redos: 2 },
    { rank: 7, techName: "Z Coisman", office: "Knoxville", thirtydayScore: 58.65, tendayScore: 50.00, dailyScores: { "04/20": 66.67, "04/21": 50.00 }, completions: 13, redos: 1 },
    { rank: 8, techName: "D Hodge", office: "Asheville", thirtydayScore: 57.89, tendayScore: 72.73, dailyScores: { "04/23": 50.00 }, completions: 12, redos: 0 },
    { rank: 9, techName: "D Murray", office: "St. Louis", thirtydayScore: 56.67, tendayScore: 56.67, dailyScores: {}, completions: 11, redos: 1 },
    { rank: 10, techName: "Z Gonzalez", office: "Richmond", thirtydayScore: 56.64, tendayScore: 51.11, dailyScores: { "04/20": 50.00, "04/21": 50.00 }, completions: 13, redos: 2 },
  ];

  // Dashboard: Location Ranking Data (Sample from provided data)
  const locationRankingRecords: LocationRankingRecord[] = [
    { rank: 1, office: "Richmond", thirtydayScore: 54.78, tendayScore: 50.00, dailyScores: { "04/20": 50.00, "04/21": 50.00 } },
    { rank: 2, office: "Jacksonville", thirtydayScore: 48.95, tendayScore: 43.51, dailyScores: { "04/20": 56.52, "04/21": 50.00 } },
    { rank: 3, office: "Norfolk", thirtydayScore: 48.52, tendayScore: 39.19, dailyScores: { "04/20": 81.82, "04/21": 66.67 } },
    { rank: 4, office: "Lake Charles", thirtydayScore: 47.83, tendayScore: 47.83, dailyScores: {} },
    { rank: 5, office: "St. Louis", thirtydayScore: 47.14, tendayScore: 45.81, dailyScores: { "04/18": 100.00 } },
    { rank: 6, office: "San Antonio", thirtydayScore: 47.06, tendayScore: 47.06, dailyScores: {} },
    { rank: 7, office: "Chattanooga", thirtydayScore: 44.74, tendayScore: 37.86, dailyScores: { "04/18": 42.86 } },
    { rank: 8, office: "Nashville", thirtydayScore: 43.84, tendayScore: 44.10, dailyScores: { "04/20": 31.58 } },
    { rank: 9, office: "Raleigh", thirtydayScore: 43.73, tendayScore: 44.12, dailyScores: { "04/20": 61.11 } },
    { rank: 10, office: "Atlanta", thirtydayScore: 43.47, tendayScore: 40.91, dailyScores: { "04/20": 42.86 } },
  ];

  // Dashboard: Ticket Statistics
  const ticketStats: TicketStatistic[] = [
    { date: "2026-05-17", status: "open", count: 12, type: "daily" },
    { date: "2026-05-17", status: "in-progress", count: 8, type: "daily" },
    { date: "2026-05-17", status: "resolved", count: 15, type: "daily" },
    { date: "2026-05-17", status: "closed", count: 5, type: "daily" },
    { date: "May 2026", status: "open", count: 150, type: "monthly" },
    { date: "May 2026", status: "in-progress", count: 95, type: "monthly" },
    { date: "May 2026", status: "resolved", count: 210, type: "monthly" },
    { date: "May 2026", status: "closed", count: 45, type: "monthly" },
  ];

  // Dashboard: Overall Status
  const overallStatus: DashboardOverallStatus[] = [
    {
      dateRange: { start: "04/18/2026", end: "05/17/2026" },
      location: "ALL",
      totalTickets: 502,
      openTickets: 150,
      inProgressTickets: 95,
      resolvedTickets: 210,
      closedTickets: 47,
      pendingClaims: 8,
      csrActivityCount: 240,
    },
  ];

  // Insert all dummy data
  await db.parts.bulkAdd(parts);
  await db.tickets.bulkAdd(tickets);
  await db.claims.bulkAdd(claims);
  await db.reports.bulkAdd(reports);
  await db.users.bulkAdd(users);
  await db.techRanking.bulkAdd(techRankingRecords);
  await db.locationRanking.bulkAdd(locationRankingRecords);
  await db.ticketStatistics.bulkAdd(ticketStats);
  await db.overallStatus.bulkAdd(overallStatus);

  console.log("✓ Dummy data initialized successfully");
}
