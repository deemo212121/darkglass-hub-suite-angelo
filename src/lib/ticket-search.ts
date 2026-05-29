export interface TicketSearchEntry {
  ticketNo: string;
  customer: string;
  city: string;
  zip: string;
  status: string;
}

export const TICKET_SEARCH_INDEX: TicketSearchEntry[] = [
  { ticketNo: "017151274136", customer: "Robert Chance", city: "DEWEYVILLE", zip: "77614", status: "CSR-Assigned to ASC" },
  { ticketNo: "039873174136", customer: "Robert Chance", city: "DEWEYVILLE", zip: "77614", status: "CL-Claimed" },
  { ticketNo: "026000671769DF1", customer: "Rose Phillips", city: "ELLENWOOD", zip: "30294", status: "OP-Waiting for Part" },
  { ticketNo: "1007208750-10", customer: "Charles Mcdonald", city: "GREENSBORO", zip: "", status: "CSR-Assigned to ASC" },
  { ticketNo: "26000679102DF", customer: "Brian Rowe", city: "SHADY DALE", zip: "30071", status: "CSR-Assigned to ASC" },
  { ticketNo: "7039321404BL-13", customer: "Melissa Beaver", city: "EATONTON", zip: "", status: "OP-Waiting for Part" },
  { ticketNo: "SA-3433383", customer: "Accent Overlook", city: "CANTON", zip: "", status: "CSR-Left Message for Cx" },
  { ticketNo: "SA-3431358", customer: "Evelin Tirado", city: "EATONTON", zip: "", status: "CSR-Left Message for Cx" },
  { ticketNo: "SA-3458831", customer: "Neal Market", city: "GREENSBORO", zip: "", status: "CSR-Assigned to ASC" },
  { ticketNo: "3850106E11", customer: "Tricon Propertymanager", city: "DALLAS", zip: "", status: "OP-UPDATE HOLD" },
  { ticketNo: "26000663669DF1", customer: "Shirley Gentry", city: "TAYLORSVILLE", zip: "", status: "TR-Need Triage" },
  { ticketNo: "SA-34125461", customer: "Mike Daly", city: "ACWORTH", zip: "", status: "TR-Need Triage" },
  { ticketNo: "SA-34156911", customer: "Chakradhar Kalivarapu", city: "CUMMING", zip: "", status: "TR-Need Triage" },
  { ticketNo: "SA-34172341", customer: "Amy Boquist", city: "TALMO", zip: "", status: "CSR-Needs Scheduling" },
  { ticketNo: "O-70646619381", customer: "Daiquiri Cummings", city: "OXFORD", zip: "", status: "OP-UPDATE HOLD" },
  { ticketNo: "26000663027DF1", customer: "Antoine Caldwell", city: "JACKSON", zip: "", status: "TR-Need Triage" },
  { ticketNo: "SA-33957161", customer: "Kisha Snell", city: "ROCKMART", zip: "", status: "CSR-Needs Scheduling" },
  { ticketNo: "SA-33860641", customer: "Karla Lares", city: "CANTON", zip: "", status: "CSR-Needs Scheduling" },
  { ticketNo: "SA-33989861", customer: "Maryann Seybold", city: "WALESKA", zip: "", status: "CSR-Needs Scheduling" },
  { ticketNo: "O-30572561511", customer: "Harry Piedra", city: "Murrayville", zip: "", status: "TR-Need PO" },
  { ticketNo: "H4249184", customer: "Kimberly Scott", city: "SPARTA", zip: "", status: "OP-Waiting for Part" },
  { ticketNo: "BZ48136REL311", customer: "Cathy Nelson", city: "ATLANTA", zip: "", status: "OP-UPDATE HOLD" },
  { ticketNo: "SA-33617561", customer: "Robin Parton", city: "JASPER", zip: "", status: "TR-Need Triage" },
  { ticketNo: "O-2142645329-16", customer: "Daniel Jaramilo", city: "WOODSTOCK", zip: "", status: "CL-Parts Back Ordered" },
  { ticketNo: "1007153963-101", customer: "Fred Evans", city: "LOCUST GROVE", zip: "", status: "CSR-Left Message for Cx" },
  { ticketNo: "1007153025-102", customer: "Chelsea Stinson", city: "GOOD HOPE", zip: "", status: "OP-UPDATE HOLD" },
  { ticketNo: "1007143353-101", customer: "Chris Edmondson", city: "JACKSON", zip: "", status: "OP-Waiting for Part" },
  { ticketNo: "SA-33596291", customer: "Sarah Thomason", city: "BALL GROUND", zip: "", status: "CL-Parts Back Ordered" },
  { ticketNo: "SA-33643491", customer: "Ronnie Deese", city: "TALLAPOOSA", zip: "", status: "TR-Need Triage" },
  { ticketNo: "SA-33646571", customer: "Ronnie Deese", city: "TALLAPOOSA", zip: "", status: "TR-Need Triage" },
  { ticketNo: "26000647878DF1", customer: "Lorraine Lobos", city: "GAINESVILLE", zip: "", status: "TR-Need PO" },
  { ticketNo: "498078311", customer: "Billy Akins", city: "CARTERSVILLE", zip: "", status: "OP-Waiting for Part" },
  { ticketNo: "SA-33466591", customer: "Susan Garcia", city: "ACWORTH", zip: "", status: "CSR-Needs Scheduling" },
  { ticketNo: "26000640263DF1", customer: "Pamela Dupree", city: "ARAGON", zip: "", status: "OP-Waiting for Part" },
  { ticketNo: "SA-33224951", customer: "Eugene Griffin", city: "TAYLORSVILLE", zip: "", status: "OP-UPDATE HOLD" },
  { ticketNo: "SA-33319261", customer: "Dianne Bishop", city: "CANTON", zip: "", status: "CSR-Needs Scheduling" },
  { ticketNo: "26000635951DF1", customer: "Jeni Davis", city: "WINSTON", zip: "", status: "CSR-Needs Scheduling" },
  { ticketNo: "26000638416DF1", customer: "Lisa Bailey", city: "VILLA RICA", zip: "", status: "OP-Waiting for Part" },
  { ticketNo: "SA-33171622", customer: "Lisa Brewer", city: "CANTON", zip: "", status: "CSR-Needs Scheduling" },
  { ticketNo: "26000633099DF1", customer: "Cara Korom", city: "BALDWIN", zip: "", status: "CL-Parts Back Ordered" },
  { ticketNo: "SA-32862182", customer: "Joe Wahn", city: "ATLANTA", zip: "", status: "TR-Need Triage" },
  { ticketNo: "SA-32707502", customer: "Neal Market", city: "GREENSBORO", zip: "", status: "CSR-Needs Scheduling" },
  { ticketNo: "3844719E11", customer: "Laura Brennan", city: "WOODSTOCK", zip: "", status: "OP-Waiting for Part" },
  { ticketNo: "SA-32236223", customer: "Brian Gokey", city: "Cartersville", zip: "", status: "OP-UPDATE HOLD" },
  { ticketNo: "1006996918-112", customer: "Elizabeth Prince", city: "ALPHARETTA", zip: "", status: "OP-Waiting for Part" },
  { ticketNo: "SA-31905321", customer: "Morgan Beck", city: "JASPER", zip: "", status: "OP-Waiting for Part" },
  { ticketNo: "1006996058-103", customer: "Kim Robbins", city: "WINTERVILLE", zip: "", status: "OP-Waiting for Part" },
  { ticketNo: "4004939472", customer: "Stacy Clark", city: "WALESKA", zip: "", status: "OP-UPDATE HOLD" },
  { ticketNo: "SNWV44E2BCC6-22", customer: "Patricia Harper", city: "SPARTA", zip: "", status: "CSR-Left Message for Cx" },
];

export function normalizeTicketSearchValue(value: string) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}
