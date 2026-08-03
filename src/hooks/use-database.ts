import { useEffect, useState } from "react";
import type { Part, Ticket, Claim, Report, User, TechRankingRecord, LocationRankingRecord, TicketStatistic, DashboardOverallStatus } from "@/lib/db";
import {
  getParts,
  getTickets,
  getClaims,
  getReports,
  getUsers,
  addPart,
  addTicket,
  addClaim,
  addReport,
  addUser,
  updatePart,
  updateTicket,
  updateClaim,
  updateUser,
  deletePart,
  getTicketsByStatus,
  getClaimsByStatus,
  getReportsByType,
  getUserByEmail,
  getTechRanking,
  getTechRankingByOffice,
  addTechRanking,
  getLocationRanking,
  getLocationRankingByOffice,
  addLocationRanking,
  getTicketStatistics,
  getTicketStatisticsByType,
  getTicketStatisticsByDate,
  addTicketStatistic,
  getOverallStatus,
  getOverallStatusByLocation,
  addOverallStatus,
  updateOverallStatus,
} from "@/lib/db-api";

// Hook to fetch all parts
export function useParts() {
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getParts().then(setParts).finally(() => setLoading(false));
  }, []);

  return { parts, loading };
}

// Hook to fetch all tickets
export function useTickets() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTickets().then(setTickets).finally(() => setLoading(false));
  }, []);

  return { tickets, loading };
}

// Hook to fetch all claims
export function useClaims() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getClaims().then(setClaims).finally(() => setLoading(false));
  }, []);

  return { claims, loading };
}

// Hook to fetch all reports
export function useReports() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getReports().then(setReports).finally(() => setLoading(false));
  }, []);

  return { reports, loading };
}

// Hook to fetch all users
export function useUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getUsers().then(setUsers).finally(() => setLoading(false));
  }, []);

  return { users, loading };
}

// Hook to fetch tech ranking
export function useTechRanking() {
  const [techRanking, setTechRanking] = useState<TechRankingRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTechRanking().then(setTechRanking).finally(() => setLoading(false));
  }, []);

  return { techRanking, loading };
}

// Hook to fetch location ranking
export function useLocationRanking() {
  const [locationRanking, setLocationRanking] = useState<LocationRankingRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getLocationRanking().then(setLocationRanking).finally(() => setLoading(false));
  }, []);

  return { locationRanking, loading };
}

// Hook to fetch ticket statistics
export function useTicketStatistics() {
  const [stats, setStats] = useState<TicketStatistic[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTicketStatistics().then(setStats).finally(() => setLoading(false));
  }, []);

  return { stats, loading };
}

// Hook to fetch overall status
export function useOverallStatus() {
  const [status, setStatus] = useState<DashboardOverallStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getOverallStatus().then(setStatus).finally(() => setLoading(false));
  }, []);

  return { status, loading };
}

// Re-export API functions for direct use
export {
  getParts,
  getTickets,
  getClaims,
  getReports,
  getUsers,
  addPart,
  addTicket,
  addClaim,
  addReport,
  addUser,
  updatePart,
  updateTicket,
  updateClaim,
  updateUser,
  deletePart,
  getTicketsByStatus,
  getClaimsByStatus,
  getReportsByType,
  getUserByEmail,
  getTechRanking,
  getTechRankingByOffice,
  addTechRanking,
  getLocationRanking,
  getLocationRankingByOffice,
  addLocationRanking,
  getTicketStatistics,
  getTicketStatisticsByType,
  getTicketStatisticsByDate,
  addTicketStatistic,
  getOverallStatus,
  getOverallStatusByLocation,
  addOverallStatus,
  updateOverallStatus,
};
