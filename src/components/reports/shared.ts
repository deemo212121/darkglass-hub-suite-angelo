export const LOCATIONS = [
  "","Asheville","Atlanta","Birmingham","Cape Girardeau","Chattanooga","Columbus",
  "Dallas","Destin","Huntsville","Jackson,MS","Jackson,TN","Jacksonville","Jonesboro",
  "Knoxville","Lake Charles","Little Rock","Louisville","Memphis","Mobile","Montgomery",
  "Nashville","Norfolk","Richmond","San Antonio","St. Louis","Wilmington",
];
export const CSR_NAMES = [
  "A'Dejaun Tyson","Abel Severino","Abraham Im","Alaska Olinger","Aleena Hii",
  "Alex Myles","Alexxis Henry","Alexy Rayos","Alona Jane Bautista","Alyssa Diones",
  "Amanda Simmons","Ana Jessa Vito","Andre Riddle","Andy Oh","Angelo Husain",
  "Angelo Mendoza","Anna Dominique Dimacali","Anna Seo","Annan Odongo","Brandon Phillips",
  "Brya'shawn Butler","Chris Simpson","Danny Thornton","Darius Brown","Dominic Holman",
];
export const MANAGERS = [
  "Alexxis Henry","Annan Odongo","Brandon Phillips","Brya'shawn Butler","Chris Simpson","Danny Thornton",
];
export const TECHS_FULL = [
  "Damon Ottley","Marc James","Nathan Wagner","Christian Clark","Gabriel Talley",
  "Jaylon Yarbrough","Andres Mota","Jordan Davis","Josh Malloch","Justin Alvarez",
  "Edward Lindsey","Zachary Gonzalez","Andre Riddle","Cole Mushinsky","Cooper Shaffett",
  "Corey Cage","Darius Brown","Jonathan Knox","Joseph Wease","Kurt Merckel",
];
export const USER_TYPES = ["Admin","CSR","Claim Manager","HR","Manager","Part Manager","Superuser","Tech Manager","Technician"];
export const SERVICE_TYPES_SS = [
  "Before Service","Carry In","Demo Service","Exchange Repair","In Home",
  "Initial Installation","Inspection","Installation Checking","Insurance",
  "Phone Fix","Pickup Service","Product Return","Recall","Service Handling","Stock Repair",
];
export const PART_DISTRIBUTORS = ["","Encompass","LG","Marcone","Samsung"];
export const REPAIR_STATUSES = [
  "TR-Need Triage","TR-Need PO","OP-Waiting for Part","OP-Ready for Service",
  "OP-Reschedule Follow up","Complete","Cancelled",
];
export const pick = <T,>(a: T[], i: number) => a[i % a.length];
export const pad = (n: number) => String(n).padStart(4, "0");
export const todayStr = () => new Date().toISOString().slice(0, 10);
export const offsetStr = (days: number) => {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
