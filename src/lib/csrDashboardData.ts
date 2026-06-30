/**
 * CSR Dashboard / Daily Report sample data.
 *
 * Provides the richer roster used by the redesigned CSR Dashboard,
 * Status Summary, and Daily Report screens. Will eventually be replaced
 * by live Supabase queries; for now it's a self-contained demo dataset
 * so the dashboards render with realistic team/location distributions.
 */

export type CSRTeam = "TEAM DANIELA" | "TEAM ROBYN" | "TEAM ROCHELLE" | "TEAM SHANE";

export interface CSRAgent {
  team: CSRTeam;
  name: string;
  position: string;
  startDate: string;
  /** Branches this agent covers. Used by the location filter / pie chart. */
  locations: string[];
  task: string;
  gh: number;
  total: number;
  schedule: number;
  attempt: number;
  update: number;
  /** Free-text mistake summary with date references, or null when clean. */
  mistake: string | null;
  warning: number;
}

export const CSR_TEAMS: readonly CSRTeam[] = [
  "TEAM DANIELA",
  "TEAM ROBYN",
  "TEAM ROCHELLE",
  "TEAM SHANE",
] as const;

export const CSR_TEAM_COLORS: Record<string, string> = {
  "TEAM DANIELA": "#3b82f6",
  "TEAM ROBYN": "#34d399",
  "TEAM ROCHELLE": "#a78bfa",
  "TEAM SHANE": "#fb923c",
};

export const CSR_AGENTS: CSRAgent[] = [
  // TEAM DANIELA
  { team: "TEAM DANIELA", name: "Anna Dela Cruz", position: "Senior CSR", startDate: "01/15/26", locations: ["Asheville", "Atlanta"], task: "In", gh: 45, total: 70, schedule: 38, attempt: 32, update: 5, mistake: "5/12 missed callback / 5/18 wrong status", warning: 1 },
  { team: "TEAM DANIELA", name: "Jeryan Lopez", position: "CSR Agent", startDate: "02/01/26", locations: ["Birmingham"], task: "In", gh: 42, total: 65, schedule: 36, attempt: 29, update: 4, mistake: null, warning: 0 },
  { team: "TEAM DANIELA", name: "Rogie Ortega", position: "CSR Agent", startDate: "01/22/26", locations: ["Chattanooga", "Knoxville"], task: "In", gh: 40, total: 60, schedule: 33, attempt: 27, update: 3, mistake: null, warning: 0 },
  { team: "TEAM DANIELA", name: "Alona Bautista", position: "Senior CSR", startDate: "03/10/26", locations: ["Nashville"], task: "In", gh: 50, total: 85, schedule: 45, attempt: 40, update: 6, mistake: "5/22 update missed", warning: 0 },

  // TEAM ROBYN
  { team: "TEAM ROBYN", name: "Ma. Czarina Lim", position: "CSR Agent", startDate: "02/14/26", locations: ["Memphis", "Jackson, TN"], task: "In", gh: 38, total: 58, schedule: 31, attempt: 27, update: 4, mistake: null, warning: 0 },
  { team: "TEAM ROBYN", name: "Marlon Reyes", position: "Senior CSR", startDate: "01/05/26", locations: ["Mobile", "Montgomery"], task: "In", gh: 44, total: 72, schedule: 37, attempt: 35, update: 5, mistake: "6/02 wrong ticket flow", warning: 1 },
  { team: "TEAM ROBYN", name: "Maritess Santos", position: "CSR Agent", startDate: "02/28/26", locations: ["Jacksonville", "Tallahassee"], task: "In", gh: 36, total: 55, schedule: 30, attempt: 25, update: 2, mistake: null, warning: 0 },

  // TEAM ROCHELLE
  { team: "TEAM ROCHELLE", name: "Jose Rivera", position: "CSR Agent", startDate: "01/18/26", locations: ["Raleigh", "Wilmington"], task: "In", gh: 39, total: 62, schedule: 34, attempt: 28, update: 4, mistake: null, warning: 0 },
  { team: "TEAM ROCHELLE", name: "Maria Pascual", position: "Senior CSR", startDate: "12/01/25", locations: ["Richmond", "Norfolk"], task: "In", gh: 47, total: 78, schedule: 42, attempt: 36, update: 5, mistake: "5/30 missed status update", warning: 0 },
  { team: "TEAM ROCHELLE", name: "Karen Mendoza", position: "CSR Agent", startDate: "03/01/26", locations: ["Savannah"], task: "In", gh: 35, total: 52, schedule: 28, attempt: 24, update: 3, mistake: null, warning: 0 },

  // TEAM SHANE
  { team: "TEAM SHANE", name: "Patrick Dela Cruz", position: "CSR Agent", startDate: "02/05/26", locations: ["Huntsville", "Birmingham"], task: "In", gh: 41, total: 66, schedule: 35, attempt: 31, update: 4, mistake: null, warning: 0 },
  { team: "TEAM SHANE", name: "Carmen Lim", position: "Senior CSR", startDate: "11/15/25", locations: ["St. Louis", "Cape Girardeau"], task: "In", gh: 49, total: 82, schedule: 44, attempt: 38, update: 6, mistake: "5/20 / 5/28 chargeable error", warning: 2 },
  { team: "TEAM SHANE", name: "Roland Cruz", position: "CSR Agent", startDate: "01/30/26", locations: ["New Orleans", "Lake Charles"], task: "In", gh: 37, total: 54, schedule: 30, attempt: 24, update: 2, mistake: null, warning: 0 },
  { team: "TEAM SHANE", name: "Bianca Aquino", position: "CSR Agent", startDate: "03/15/26", locations: ["Dallas", "San Antonio"], task: "In", gh: 33, total: 50, schedule: 27, attempt: 23, update: 2, mistake: null, warning: 0 },
];

export interface CSRMistakeEntry {
  name: string;
  mistakes: number;
  date: string;
  reason: string;
  actionTaken: string;
}

export const CSR_MISTAKES: CSRMistakeEntry[] = [
  { name: "Anna Dela Cruz",  mistakes: 2, date: "05/12/26", reason: "Missed callback within SLA",    actionTaken: "Coaching session + warning issued" },
  { name: "Marlon Reyes",    mistakes: 1, date: "06/02/26", reason: "Wrong ticket flow assignment",  actionTaken: "Re-trained on flow types" },
  { name: "Maria Pascual",   mistakes: 1, date: "05/30/26", reason: "Missed status update",          actionTaken: "Process reminder posted" },
  { name: "Alona Bautista",  mistakes: 1, date: "05/22/26", reason: "Update note not logged",        actionTaken: "Verbal warning" },
  { name: "Carmen Lim",      mistakes: 2, date: "05/28/26", reason: "Chargeable error on PO",        actionTaken: "Manager review + 2nd warning" },
];

export interface CSRTrendPoint {
  date: string;
  schedule: number;
  attempt: number;
  mistakes: number;
}

/** Last-10-day trend for the dashboard. Dates use MM/DD format. */
export const CSR_TREND_10: CSRTrendPoint[] = [
  { date: "5/24", schedule: 285, attempt: 230, mistakes: 2 },
  { date: "5/25", schedule: 290, attempt: 238, mistakes: 1 },
  { date: "5/26", schedule: 305, attempt: 245, mistakes: 3 },
  { date: "5/27", schedule: 312, attempt: 251, mistakes: 0 },
  { date: "5/28", schedule: 298, attempt: 244, mistakes: 2 },
  { date: "5/29", schedule: 301, attempt: 247, mistakes: 1 },
  { date: "5/30", schedule: 295, attempt: 240, mistakes: 1 },
  { date: "6/01", schedule: 318, attempt: 256, mistakes: 0 },
  { date: "6/02", schedule: 322, attempt: 261, mistakes: 1 },
  { date: "6/03", schedule: 330, attempt: 268, mistakes: 0 },
];
