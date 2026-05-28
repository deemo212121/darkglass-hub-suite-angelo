import { db } from "./db";

// Initialize database on app start (client-side only)
export async function initDatabase() {
  // Only run on client side
  if (typeof window === "undefined") return;

  try {
    await db.open();
  } catch (error) {
    console.error("Failed to initialize database:", error);
  }
}

// Parts API
export async function getParts() {
  return await db.parts.toArray();
}

export async function getPartById(id: number) {
  return await db.parts.get(id);
}

export async function addPart(part: Omit<typeof db.parts, "id">) {
  return await db.parts.add(part as any);
}

export async function updatePart(id: number, updates: Partial<typeof db.parts>) {
  return await db.parts.update(id, updates as any);
}

export async function deletePart(id: number) {
  return await db.parts.delete(id);
}

// Tickets API
export async function getTickets() {
  return await db.tickets.toArray();
}

export async function getTicketById(id: number) {
  return await db.tickets.get(id);
}

export async function getTicketsByStatus(status: string) {
  return await db.tickets.where("status").equals(status).toArray();
}

export async function addTicket(ticket: Omit<typeof db.tickets, "id">) {
  return await db.tickets.add(ticket as any);
}

export async function updateTicket(id: number, updates: Partial<typeof db.tickets>) {
  return await db.tickets.update(id, updates as any);
}

// Claims API
export async function getClaims() {
  return await db.claims.toArray();
}

export async function getClaimById(id: number) {
  return await db.claims.get(id);
}

export async function getClaimsByStatus(status: string) {
  return await db.claims.where("status").equals(status).toArray();
}

export async function addClaim(claim: Omit<typeof db.claims, "id">) {
  return await db.claims.add(claim as any);
}

export async function updateClaim(id: number, updates: Partial<typeof db.claims>) {
  return await db.claims.update(id, updates as any);
}

// Reports API
export async function getReports() {
  return await db.reports.toArray();
}

export async function getReportById(id: number) {
  return await db.reports.get(id);
}

export async function getReportsByType(type: string) {
  return await db.reports.where("type").equals(type).toArray();
}

export async function addReport(report: Omit<typeof db.reports, "id">) {
  return await db.reports.add(report as any);
}

// Users API
export async function getUsers() {
  return await db.users.toArray();
}

export async function getUserById(id: number) {
  return await db.users.get(id);
}

export async function getUserByEmail(email: string) {
  return await db.users.where("email").equals(email).first();
}

export async function addUser(user: Omit<typeof db.users, "id">) {
  return await db.users.add(user as any);
}

export async function updateUser(id: number, updates: Partial<typeof db.users>) {
  return await db.users.update(id, updates as any);
}

// Dashboard: Tech Ranking API
export async function getTechRanking() {
  return await db.techRanking.toArray();
}

export async function getTechRankingByOffice(office: string) {
  return await db.techRanking.where("office").equals(office).toArray();
}

export async function addTechRanking(record: Omit<typeof db.techRanking, "id">) {
  return await db.techRanking.add(record as any);
}

// Dashboard: Location Ranking API
export async function getLocationRanking() {
  return await db.locationRanking.toArray();
}

export async function getLocationRankingByOffice(office: string) {
  return await db.locationRanking.where("office").equals(office).first();
}

export async function addLocationRanking(record: Omit<typeof db.locationRanking, "id">) {
  return await db.locationRanking.add(record as any);
}

// Dashboard: Ticket Statistics API
export async function getTicketStatistics() {
  return await db.ticketStatistics.toArray();
}

export async function getTicketStatisticsByType(type: "monthly" | "daily") {
  return await db.ticketStatistics.where("type").equals(type).toArray();
}

export async function getTicketStatisticsByDate(date: string) {
  return await db.ticketStatistics.where("date").equals(date).toArray();
}

export async function addTicketStatistic(stat: Omit<typeof db.ticketStatistics, "id">) {
  return await db.ticketStatistics.add(stat as any);
}

// Dashboard: Overall Status API
export async function getOverallStatus() {
  return await db.overallStatus.toArray();
}

export async function getOverallStatusByLocation(location: string) {
  return await db.overallStatus.where("location").equals(location).first();
}

export async function addOverallStatus(status: Omit<typeof db.overallStatus, "id">) {
  return await db.overallStatus.add(status as any);
}

export async function updateOverallStatus(id: number, updates: Partial<typeof db.overallStatus>) {
  return await db.overallStatus.update(id, updates as any);
}
