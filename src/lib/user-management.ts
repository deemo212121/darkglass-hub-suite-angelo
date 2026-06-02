import { ALL_TECHNICIANS, LOCATIONS } from "@/lib/locations";

export interface UserManagementRecord {
  id: string;
  loginName: string;
  userName: string;
  type: string;
  email: string;
  manager: string;
  technicianId: string;
  office: string;
  locations: string;
}

const ALL_LOCATIONS = LOCATIONS.join(",");

const CORE_USERS: UserManagementRecord[] = [
  { id: "2", loginName: "Memphis.Admin", userName: "Memphis Admin", type: "Admin", email: "admin@usinhomeservices.com", manager: "Nashville Admin", technicianId: "LEEAA05274276", office: "Memphis", locations: ALL_LOCATIONS },
  { id: "3", loginName: "DAVID.SIMS", userName: "David Sims", type: "Tech Manager", email: "david.sims@usinhomeservices.com", manager: "Kenny Shin", technicianId: "SIMSA08016145", office: "Birmingham", locations: "Birmingham" },
  { id: "4", loginName: "Sean.Smith", userName: "Sean Smith", type: "Tech Manager", email: "sean.smith81@yahoo.com", manager: "Justin Parker", technicianId: "SMITA10107693", office: "Memphis", locations: "Memphis" },
  { id: "5", loginName: "Rico.Shaw", userName: "Rico Shaw", type: "Technician", email: "ricoshaw55@gmail.com", manager: "Sean Smith", technicianId: "SHAWA11215713", office: "Memphis", locations: "Memphis" },
  { id: "11", loginName: "Ian.Montesclaros", userName: "Ian Montesclaros", type: "Claim Manager", email: "ian.m@usinhomeservices.com", manager: "Memphis Admin", technicianId: "", office: "Philippines", locations: ALL_LOCATIONS },
  { id: "16", loginName: "Danny.Thorton", userName: "Danny Thornton", type: "Tech Manager", email: "danny.thornton@usinhomeservices.com", manager: "Justin Parker", technicianId: "THORA10268549", office: "Lake Charles", locations: "Jackson,MS,Lake Charles,Little Rock,New Orleans" },
  { id: "17", loginName: "Nashville.Admin", userName: "Nashville Admin", type: "Admin", email: "Chris@usinhomeservices.com", manager: "", technicianId: "YONGA04191051", office: "Nashville", locations: ALL_LOCATIONS },
  { id: "19", loginName: "Kemuel.Tamayo", userName: "Kemuel Tamayo", type: "Tech Manager", email: "kemuel.tamayo@usinhomeservices", manager: "Aleena Hii", technicianId: "", office: "Philippines", locations: ALL_LOCATIONS },
  { id: "20", loginName: "BAOLIN.ZHANG", userName: "Baolin Henry Zhang", type: "Technician", email: "zhanguthsc@gmail.com", manager: "Leo Sun", technicianId: "ZHANA02155687", office: "Nashville", locations: "Nashville" },
  { id: "22", loginName: "Alexxis.Henry", userName: "Alexxis Henry", type: "Tech Manager", email: "trackstar9691@gmail.com", manager: "Daven Hodge", technicianId: "HENRA06104507", office: "Raleigh", locations: "Raleigh" },
  { id: "26", loginName: "KENNY.SHIN", userName: "Kenny Shin", type: "Manager", email: "kennyshin@usinhomeservices.com", manager: "Marjorie Valdez", technicianId: "SHINA08195969", office: "Birmingham", locations: ALL_LOCATIONS },
  { id: "28", loginName: "ALEENA.HII", userName: "Aleena Hii", type: "Admin", email: "aleena@usinhomeservices.com", manager: "Memphis Admin", technicianId: "", office: "Asheville", locations: ALL_LOCATIONS },
  { id: "33", loginName: "Anna.Seo", userName: "Anna Seo", type: "Part Manager", email: "", manager: "Naveen Lakhani", technicianId: "", office: "Atlanta", locations: "Atlanta" },
  { id: "42", loginName: "Amanda.Simmons", userName: "Amanda Simmons", type: "Part Manager", email: "uscb@usinhomeservices.com", manager: "Annan Odongo", technicianId: "", office: "Columbus", locations: "Columbus" },
  { id: "50", loginName: "Zonate.Grant", userName: "Zonate Grant", type: "Technician", email: "zontae7grant@gmail.com", manager: "Kenny Shin", technicianId: "GRANA07047662", office: "Birmingham", locations: "Birmingham" },
  { id: "53", loginName: "Zakarya.Moradi", userName: "Zakarya Moradi", type: "Technician", email: "zakarya.moradi2015@gmail.com", manager: "Daven Hodge", technicianId: "MORAA03107728", office: "Jacksonville", locations: "Jacksonville" },
  { id: "57", loginName: "Justin.Parker", userName: "Justin Parker", type: "Tech Manager", email: "justin.parker@usinhomeservices", manager: "Marjorie Valdez", technicianId: "PARKA01031129", office: "Jackson,TN", locations: ALL_LOCATIONS },
  { id: "65", loginName: "Krista.Griffiss", userName: "Krista Griffiss", type: "Manager", email: "ustl@usinhomeservices.com", manager: "Naveen Lakhani", technicianId: "", office: "Tallahassee", locations: ALL_LOCATIONS },
  { id: "67", loginName: "Bryeshawn.Butler", userName: "Brye'shawn Butler", type: "Tech Manager", email: "bryeshawn.butler@usinhomeservices", manager: "Daven Hodge", technicianId: "BUTLA04011325", office: "Wilmington", locations: "Wilmington" },
  { id: "73", loginName: "Matt.Simmons", userName: "Matt Simmons", type: "Tech Manager", email: "matt.simmons@usinhomeservices", manager: "Jonathon Allen", technicianId: "SIMMA08257486", office: "Columbus", locations: "Columbus" },
  { id: "75", loginName: "Robyn.Heredia", userName: "Robyn Heredia", type: "CSR", email: "herediarobmae.rmh@gmail.com", manager: "Raul Bayuyos Jr", technicianId: "", office: "Philippines", locations: ALL_LOCATIONS },
  { id: "80", loginName: "Mark.Marquez", userName: "Mark Marquez", type: "Tech Manager", email: "marky0120@gmail.com", manager: "Kemuel Tamayo", technicianId: "", office: "Philippines", locations: ALL_LOCATIONS },
  { id: "83", loginName: "Matthew.Mccrary", userName: "Matthew Mccrary", type: "Tech Manager", email: "matthewmccrary@usinhomeservices", manager: "Jonathon Allen", technicianId: "MCCRA05199062", office: "Tallahassee", locations: "Tallahassee" },
  { id: "90", loginName: "andy.oh", userName: "Andy Oh", type: "Tech Manager", email: "keyoungoh@gmail.com", manager: "Kenny Shin", technicianId: "OHAAA12175312", office: "Montgomery", locations: "Birmingham,Montgomery" },
  { id: "98", loginName: "Daven.Hodge", userName: "Daven Hodge", type: "Tech Manager", email: "daven.hodge@usinhomeservices", manager: "Marjorie Valdez", technicianId: "HODGA03191563", office: "Asheville", locations: ALL_LOCATIONS },
  { id: "102", loginName: "Daniela.Mercado", userName: "Daniela Mercado", type: "CSR", email: "daniemarie.mercado@gmail.com", manager: "Raul Bayuyos Jr", technicianId: "", office: "Philippines", locations: ALL_LOCATIONS },
  { id: "103", loginName: "Jordan.Stanley", userName: "Jordan Stanley", type: "Tech Manager", email: "jordan.stanley@usinhomeservices", manager: "Jonathon Allen", technicianId: "STANA07137816", office: "Huntsville", locations: "Huntsville" },
  { id: "105", loginName: "Lou.Basco", userName: "Lou Basco", type: "HR", email: "lou.basco@usinhomeservices.com", manager: "Memphis Admin", technicianId: "", office: "Philippines", locations: ALL_LOCATIONS },
  { id: "109", loginName: "Lance.Novak", userName: "Lance Novak", type: "Tech Manager", email: "lance.novak@usinhomeservices", manager: "Daven Hodge", technicianId: "NOVAA09082570", office: "Savannah", locations: "Savannah" },
  { id: "112", loginName: "Jerich.Leonard", userName: "Jerich Leonard", type: "Manager", email: "bolicojerich@gmail.com", manager: "Aleena Hii", technicianId: "", office: "Philippines", locations: ALL_LOCATIONS },
  { id: "118", loginName: "Chris.Simpson", userName: "Chris Simpson", type: "Tech Manager", email: "chris.simpson@usinhomeservices", manager: "Daven Hodge", technicianId: "SIMPA10268089", office: "Norfolk", locations: "Norfolk,Richmond" },
  { id: "119", loginName: "Farris.Bruce", userName: "Farris Bruce", type: "Manager", email: "usjb@usinhomeservices.com", manager: "Naveen Lakhani", technicianId: "", office: "Jonesboro", locations: ALL_LOCATIONS },
  { id: "121", loginName: "Jeff.Lucas", userName: "Jeff Lucas", type: "Technician", email: "jefflucas252@yahoo.com", manager: "Sean Smith", technicianId: "LUCAA06020127", office: "Memphis", locations: "Memphis" },
  { id: "130", loginName: "ERIC.GUZMAN", userName: "Erick Guzman Juarez", type: "Tech Manager", email: "erick.guzman@usinhomeservices", manager: "Justin Parker", technicianId: "4984094", office: "San Antonio", locations: "Atlanta,San Antonio" },
  { id: "132", loginName: "Jenna.Kim", userName: "Jenna Kim", type: "Manager", email: "", manager: "Memphis Admin", technicianId: "", office: "Atlanta", locations: ALL_LOCATIONS },
  { id: "144", loginName: "Jonathon.Allen", userName: "Jonathon Allen", type: "Tech Manager", email: "jonathon.allen@usinhomeservices", manager: "Marjorie Valdez", technicianId: "ALLEA05312151", office: "Mobile", locations: ALL_LOCATIONS },
  { id: "149", loginName: "Percy.Smith", userName: "Percy Smith", type: "Technician", email: "smithpercyy@gmail.com", manager: "Matt Simmons", technicianId: "PSCB", office: "Columbus", locations: "Columbus" },
  { id: "155", loginName: "Reginald.Stewart", userName: "Reginald Stewart", type: "Manager", email: "usjs@usinhomeservices.com", manager: "Naveen Lakhani", technicianId: "", office: "Jackson,MS", locations: ALL_LOCATIONS },
  { id: "160", loginName: "Justin.Alverez", userName: "Justin Alverez", type: "Technician", email: "Justin2801alverez@gmail.com", manager: "Brye'shawn Butler", technicianId: "ALVAA04288884", office: "Wilmington", locations: "Wilmington" },
  { id: "167", loginName: "Arnulfo.Montesclaros", userName: "Arnulfo Montesclaros Jr", type: "Claim Manager", email: "arnulfo.montesclaros@usinhomeservices", manager: "Ian Montesclaros", technicianId: "", office: "Philippines", locations: ALL_LOCATIONS },
  { id: "173", loginName: "Maverick.Nieto", userName: "John Maverick Nieto", type: "CSR", email: "maverick.nieto@usinhomeservices", manager: "Jerich Leonard", technicianId: "", office: "Philippines", locations: ALL_LOCATIONS },
  { id: "182", loginName: "Leo.Sun", userName: "Leo Sun", type: "Tech Manager", email: "leo.s@usinhomeservices.com", manager: "Jonathon Allen", technicianId: "SUNAA06254871", office: "Nashville", locations: "Knoxville,Nashville" },
  { id: "190", loginName: "Darryel.Burdette", userName: "Darryel Burdette", type: "Technician", email: "Darryel23@gmail.com", manager: "Sean Smith", technicianId: "BURDA09127479", office: "Memphis", locations: "Memphis" },
  { id: "199", loginName: "Derious.Nichols", userName: "Derious Nichols", type: "Tech Manager", email: "derious.nichols@usinhomeservices", manager: "Justin Parker", technicianId: "NICHA02293577", office: "St. Louis", locations: "Chattanooga,New Orleans,St. Louis" },
  { id: "200", loginName: "Lashamus.Dowell", userName: "Lashamus Dowell", type: "Tech Manager", email: "Bull2federal@gmail.com", manager: "Danny Thornton", technicianId: "DOWEA08138250", office: "Dallas", locations: "Dallas,Jackson,MS" },
  { id: "203", loginName: "Annan.Odongo", userName: "Annan Odongo", type: "Part Manager", email: "usmp@usinhomeservices.com", manager: "Naveen Lakhani", technicianId: "", office: "Memphis", locations: ALL_LOCATIONS },
  { id: "210", loginName: "MarieFrances.Javier", userName: "Marie Frances Javier", type: "Claim Manager", email: "frances_javier@ymail.com", manager: "Ian Montesclaros", technicianId: "", office: "Philippines", locations: ALL_LOCATIONS },
  { id: "226", loginName: "Brandon.Phillips", userName: "Brandon Phillips", type: "Tech Manager", email: "brandon@usinhomeservices", manager: "Justin Parker", technicianId: "PHILA12160660", office: "Jackson,TN", locations: "Jackson,TN" },
  { id: "228", loginName: "Farahnaz.Qasemi", userName: "Farahnaz Qasemi", type: "Part Manager", email: "usjv@usinhomeservices.com", manager: "Farris Bruce", technicianId: "", office: "Jacksonville", locations: "Jacksonville" },
  { id: "237", loginName: "Rocky.Deles", userName: "Rocky Deles", type: "Tech Manager", email: "rocky.d.klc@gmail.com", manager: "Kemuel Tamayo", technicianId: "", office: "Philippines", locations: ALL_LOCATIONS },
  { id: "1020501005001234", loginName: "User.1020501005001234", userName: "User 1020501005001234", type: "Viewer", email: "user1020501005001234@adminhub.io", manager: "Memphis Admin", technicianId: "", office: "Memphis", locations: "Memphis" },
];

const MANAGER_POOL = ["Memphis Admin", "Nashville Admin", "Kenny Shin", "Justin Parker", "Daven Hodge", "Marjorie Valdez", "Memphis Admin", "Naveen Lakhani", "Jonathon Allen", "Sean Smith", "Danny Thornton", "Raul Bayuyos Jr", "Farris Bruce", "Ian Montesclaros"];
const OFFICE_POOL = LOCATIONS;
const TYPE_POOL = ["Admin", "Tech Manager", "Technician", "Manager", "CSR", "Claim Manager", "Part Manager", "HR", "Viewer"];

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");

function buildGeneratedRecord(index: number): UserManagementRecord {
  const technicianName = ALL_TECHNICIANS[index % ALL_TECHNICIANS.length] ?? `Technician ${index + 1}`;
  const userName = technicianName;
  const loginName = slugify(userName);
  const office = OFFICE_POOL[index % OFFICE_POOL.length] ?? "Memphis";
  const type = TYPE_POOL[index % TYPE_POOL.length] ?? "Technician";
  const manager = MANAGER_POOL[index % MANAGER_POOL.length] ?? "Memphis Admin";
  const technicianId = type === "Technician" || type === "Tech Manager" ? `${loginName.slice(0, 5).toUpperCase()}${String(100000 + index).slice(-8)}` : "";
  const locations = type === "Admin" || type === "Manager" || type === "Claim Manager" ? ALL_LOCATIONS : office;
  return {
    id: String(300 + index),
    loginName,
    userName,
    type,
    email: `${loginName || "user"}@adminhub.io`,
    manager,
    technicianId,
    office,
    locations,
  };
}

export const USER_MANAGEMENT_RECORDS: UserManagementRecord[] = Array.from({ length: 177 }, (_, index) => CORE_USERS[index] ?? buildGeneratedRecord(index - CORE_USERS.length));

export function getUserManagementRecord(userId: string) {
  const normalized = String(userId || "").toLowerCase();
  return USER_MANAGEMENT_RECORDS.find((record) =>
    [record.id, record.loginName, record.userName, record.email].some((value) => String(value || "").toLowerCase() === normalized),
  );
}

const USER_MANAGEMENT_ADMIN_TYPES = new Set(["hr", "manager", "admin", "super admin", "superadmin"]);
const AHS_SYSTEM_ACCESS_EMAILS = new Set([
  "admin@ahsolutions.com",
  "manager@ahsolutions.com",
  "hr@ahsolutions.com",
  "superadmin@ahsolutions.com",
]);

export function canAccessUserManagement(emailOrUserId: string | null | undefined) {
  const normalized = String(emailOrUserId || "").trim().toLowerCase();
  if (AHS_SYSTEM_ACCESS_EMAILS.has(normalized)) return true;

  const record = getUserManagementRecord(normalized);
  return !!record && USER_MANAGEMENT_ADMIN_TYPES.has(record.type.toLowerCase());
}

const ADMIN_ONLY_TYPES = new Set(["admin", "super admin", "superadmin"]);
const ADMIN_SYSTEM_ACCESS_EMAILS = new Set([
  "admin@ahsolutions.com",
  "superadmin@ahsolutions.com",
]);

export function canAccessAdminModule(emailOrUserId: string | null | undefined) {
  const normalized = String(emailOrUserId || "").trim().toLowerCase();
  if (ADMIN_SYSTEM_ACCESS_EMAILS.has(normalized)) return true;

  const record = getUserManagementRecord(normalized);
  return !!record && ADMIN_ONLY_TYPES.has(record.type.toLowerCase());
}
