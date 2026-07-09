// Report data structures for Daily Reports
// This file contains mock/sample data structures for all daily reports

export const hrReportData: Record<string, any> = {
  "602": {
    us: {
      interviews: [
        { branch: "Houston HQ", scheduled: 5, staffNeed: "Technician", hired: 3 },
        { branch: "Dallas", scheduled: 3, staffNeed: "CSR", hired: 2 },
        { branch: "Austin", scheduled: 2, staffNeed: "Parts", hired: 1 },
      ],
      warnings: [
        { branch: "Houston HQ", timecardWarning: 2, employeeError: 1 },
        { branch: "Dallas", timecardWarning: 0, employeeError: 0 },
      ],
    },
    ph: {
      interviews: [
        { branch: "Operations", scheduled: 8, staffNeed: "CSR", hired: 5 },
        { branch: "Claims", scheduled: 4, staffNeed: "Claims Processor", hired: 2 },
      ],
      warnings: [
        { branch: "Operations", timecardWarning: 1, employeeError: 0 },
      ],
    },
  },
};

export const csrReportData: Record<string, any> = {
  "602": {
    agents: [
      {
        team: "TEAM DANIELA",
        name: "John Doe",
        startDate: "01/15/26",
        task: "In",
        gh: 45,
        total: 45,
        schedule: 38,
        attempt: 32,
        update: 5,
        mistake: null,
        warning: 0,
      },
    ],
  },
};

export const claimsReportData: Record<string, any> = {
  "602": {
    completed: 125,
    remaining: 43,
    brands: {
      GE: 45,
      SQT: 32,
      ASSURANT: 28,
      AIG: 15,
      SS: 5,
    },
    pending: {
      "Awaiting Authorization": 15,
      "Missing Parts": 12,
      "Customer Follow-up": 8,
      "Documentation": 8,
    },
  },
};

export const triageReportData: Record<string, any> = {
  "602": {
    summary: {
      completed: 78,
      remaining: 25,
      staff: 8,
    },
    agents: [
      { name: "Jane Smith", completed: 15, remaining: 3, avgTime: "12m" },
      { name: "Bob Johnson", completed: 12, remaining: 5, avgTime: "15m" },
    ],
  },
};

export const partsReportData: Record<string, any> = {
  "602": {
    branches: [
      { branch: "Houston HQ", collections: 24, ra: 8, receives: 15 },
      { branch: "Dallas", collections: 18, ra: 5, receives: 12 },
      { branch: "Austin", collections: 15, ra: 3, receives: 10 },
    ],
  },
};

export const operationsReportData: Record<string, any> = {
  "602": {
    staff: [
      { name: "Operations Staff 1", tasks: 35, mishandled: 2, pending: 5 },
      { name: "Operations Staff 2", tasks: 42, mishandled: 1, pending: 3 },
    ],
    summary: {
      totalTasks: 280,
      totalMishandled: 8,
      totalPending: 35,
    },
  },
};

export const opsReportData: Record<string, any> = {
  "602": {
    agents: [
      { name: "Maverick Nieto", startDate: "01/15/26", hr: "HR1", workHours: "8-5", tasks: "Task list", mishandled: null, warning: 0, remarks: "" },
      { name: "Wincel Carusca", startDate: "02/01/26", hr: "HR1", workHours: "8-5", tasks: "Task list", mishandled: null, warning: 0, remarks: "" },
    ],
  },
};

// TX Daily Report Data Structures
export const eastReportData = {
  summary: {
    ltpTotal: 145,
    completionRate: 87,
    branches: 5,
  },
  branches: [
    { branch: "Houston HQ", ltp: 45, completed: 39, rate: 87, techs: 12 },
    { branch: "Dallas", ltp: 38, completed: 33, rate: 87, techs: 10 },
    { branch: "Austin", ltp: 35, completed: 31, rate: 89, techs: 9 },
    { branch: "San Antonio", ltp: 27, completed: 23, rate: 85, techs: 7 },
  ],
  technicians: [
    { name: "Tech A", branch: "Houston HQ", ltp: 15, completed: 14, rate: 93 },
    { name: "Tech B", branch: "Houston HQ", ltp: 12, completed: 10, rate: 83 },
    { name: "Tech C", branch: "Dallas", ltp: 14, completed: 12, rate: 86 },
  ],
};

export const westReportData = {
  summary: {
    ltpTotal: 98,
    completionRate: 85,
    branches: 3,
  },
  branches: [
    { branch: "El Paso", ltp: 42, completed: 36, rate: 86, techs: 8 },
    { branch: "Lubbock", ltp: 35, completed: 29, rate: 83, techs: 7 },
    { branch: "Midland", ltp: 21, completed: 18, rate: 86, techs: 5 },
  ],
  technicians: [
    { name: "Tech D", branch: "El Paso", ltp: 16, completed: 14, rate: 88 },
    { name: "Tech E", branch: "El Paso", ltp: 13, completed: 11, rate: 85 },
    { name: "Tech F", branch: "Lubbock", ltp: 12, completed: 10, rate: 83 },
  ],
};

export const centralReportData = {
  summary: {
    ltpTotal: 112,
    completionRate: 89,
    branches: 4,
  },
  branches: [
    { branch: "Waco", ltp: 38, completed: 34, rate: 89, techs: 8 },
    { branch: "Temple", ltp: 32, completed: 29, rate: 91, techs: 7 },
    { branch: "Killeen", ltp: 25, completed: 22, rate: 88, techs: 6 },
    { branch: "Bryan", ltp: 17, completed: 15, rate: 88, techs: 4 },
  ],
  technicians: [
    { name: "Tech G", branch: "Waco", ltp: 14, completed: 13, rate: 93 },
    { name: "Tech H", branch: "Waco", ltp: 12, completed: 11, rate: 92 },
    { name: "Tech I", branch: "Temple", ltp: 13, completed: 12, rate: 92 },
  ],
};
