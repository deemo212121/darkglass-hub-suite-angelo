import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS, normalizeLocationName } from "@/lib/locations";
import { useAuth } from "@/lib/auth";
import { lookupGeocode, storeGeocode } from "@/lib/supabase/geocodeCache";
import {
  getLocations as sbGetLocations,
  upsertLocation as sbUpsertLocation,
  deleteLocation as sbDeleteLocation,
  getPartAddresses as sbGetPartAddresses,
  upsertPartAddress as sbUpsertPartAddress,
  deletePartAddress as sbDeletePartAddress,
  getCoverage as sbGetCoverage,
  upsertCoverage as sbUpsertCoverage,
  insertCoverageBulk as sbInsertCoverageBulk,
  deleteCoverage as sbDeleteCoverage,
} from "@/lib/supabase/locationManagement";

const coverageCsvModules = import.meta.glob("../../grid_coverage/*.csv", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>;

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;

type LocationRow = {
  id: string;
  legacyId?: string;
  location: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zipCode: string;
  office: string;
  coordinates?: string;
  phoneNo: string;
  email: string;
  defaultPartDist: string;
  repTech: string;
  officeLocation?: string;
  deliveryRecipientName?: string;
  checkProcessing?: "Y" | "N";
  creditCardProcessing?: "Y" | "N";
  permission?: "Y" | "N";
  sms: "Y" | "N";
  emailFlag: "Y" | "N";
  autoTriage: "Y" | "N";
  encompassPickupWH?: "Y" | "N";
  availableDays?: string[];
  availableTimeSlot?: string;
  coveredTechnicians?: string[];
  laborFee?: string;
  partFee?: string;
  tripFee?: string;
  othersFee?: string;
  oowPartActual?: boolean;
};

type PartAddressRow = {
  id: string;
  name: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zipCode: string;
  location: string;
};

type CoverageRow = {
  id: string;
  location: string;
  zipCode: string;
  city: string;
  selfSchedule: string;
  daysLater: string;
  tierCode: string;
};

type MapPoint = {
  lat: number;
  lng: number;
};

type MapZipGeometry = {
  center: MapPoint;
  viewport: {
    north: number;
    south: number;
    east: number;
    west: number;
  } | null;
};

type CoverageZipGeoJson = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: {
      type: "Polygon" | "MultiPolygon";
      coordinates: any;
    };
    properties: Record<string, any>;
  }>;
};

const LOCATION_STORAGE_KEY = "ahs:location-management:locations";
const PART_ADDRESS_STORAGE_KEY = "ahs:location-management:part-addresses";
const COVERAGE_STORAGE_KEY = "ahs:location-management:coverage";

const YES_NO_OPTIONS = ["Y", "N"] as const;

const STATE_OPTIONS = [
  { value: "AL", label: "AL - Alabama" },
  { value: "AK", label: "AK - Alaska" },
  { value: "AZ", label: "AZ - Arizona" },
  { value: "AR", label: "AR - Arkansas" },
  { value: "CA", label: "CA - California" },
  { value: "CO", label: "CO - Colorado" },
  { value: "CT", label: "CT - Connecticut" },
  { value: "DE", label: "DE - Delaware" },
  { value: "DL", label: "DL" },
  { value: "DC", label: "DC - District of Columbia" },
  { value: "FL", label: "FL - Florida" },
  { value: "GA", label: "GA - Georgia" },
  { value: "HI", label: "HI - Hawaii" },
  { value: "ID", label: "ID - Idaho" },
  { value: "IL", label: "IL - Illinois" },
  { value: "IN", label: "IN - Indiana" },
  { value: "IA", label: "IA - Iowa" },
  { value: "KS", label: "KS - Kansas" },
  { value: "KY", label: "KY - Kentucky" },
  { value: "LA", label: "LA - Louisiana" },
  { value: "ME", label: "ME - Maine" },
  { value: "MD", label: "MD - Maryland" },
  { value: "MA", label: "MA - Massachusetts" },
  { value: "MI", label: "MI - Michigan" },
  { value: "MN", label: "MN - Minnesota" },
  { value: "MS", label: "MS - Mississippi" },
  { value: "MO", label: "MO - Missouri" },
  { value: "MT", label: "MT - Montana" },
  { value: "NE", label: "NE - Nebraska" },
  { value: "NV", label: "NV - Nevada" },
  { value: "NH", label: "NH - New Hampshire" },
  { value: "NJ", label: "NJ - New Jersey" },
  { value: "NM", label: "NM - New Mexico" },
  { value: "NY", label: "NY - New York" },
  { value: "NC", label: "NC - North Carolina" },
  { value: "ND", label: "ND - North Dakota" },
  { value: "OH", label: "OH - Ohio" },
  { value: "OK", label: "OK - Oklahoma" },
  { value: "OR", label: "OR - Oregon" },
  { value: "PA", label: "PA - Pennsylvania" },
  { value: "PR", label: "PR - Puerto Rico" },
  { value: "RI", label: "RI - Rhode Island" },
  { value: "SC", label: "SC - South Carolina" },
  { value: "SD", label: "SD - South Dakota" },
  { value: "TN", label: "TN - Tennessee" },
  { value: "TX", label: "TX - Texas" },
  { value: "UT", label: "UT - Utah" },
  { value: "VT", label: "VT - Vermont" },
  { value: "VA", label: "VA - Virginia" },
  { value: "WA", label: "WA - Washington" },
  { value: "WV", label: "WV - West Virginia" },
  { value: "WI", label: "WI - Wisconsin" },
  { value: "WY", label: "WY - Wyoming" },
];

const DEFAULT_PART_DIST_OPTIONS = [
  "AIG",
  "Electrolux",
  "Encompass",
  "Encompass-Birmingham / Montgomery",
  "GE",
  "LG",
  "Marcone- Birmingham / Montgomery",
  "Marcone-162468",
  "Midea",
  "Miele",
  "NSA",
  "OWS",
  "B",
  "Sharp",
  "SP",
  "Squaretrade",
  "SS",
  "Available",
].sort((left, right) => left.localeCompare(right));

const AVAILABLE_DAY_OPTIONS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const AVAILABLE_TIME_SLOT_OPTIONS = ["ANY", "AM", "PM", "EV"];

const OFFICE_LOCATION_OPTIONS = [
  "Asheville",
  "Atlanta",
  "Birmingham",
  "Cape Girardeau",
  "Chattanooga",
  "Columbus",
  "Dallas",
  "Destin",
  "Huntsville",
  "Jackson,MS",
  "Jackson,TN",
  "Jacksonville",
  "Jonesboro",
  "Knoxville",
  "Lake Charles",
  "Little Rock",
  "Louisville",
  "Memphis",
  "Mobile",
  "Montgomery",
  "Nashville",
  "New Orleans",
  "Norfolk",
  "Philippines",
  "Raleigh",
  "Richmond",
  "San Antonio",
  "Savannah",
  "St. Louis",
  "Tallahassee",
  "Wilmington",
];

const TECHNICIAN_OPTIONS = [
  "A'Dejaun Tyson",
  "Abel Severino",
  "Abraham Im",
  "Alaska Olinger",
  "Aleena Hii",
  "Alex Myles",
  "Alexxis Henry",
  "Alexy Rayos",
  "Alona Jane Bautista",
  "Alyssa Diones",
  "Amanda Simmons",
  "Ana Jessa Vito",
  "Andre Riddle",
  "Andy Oh",
  "Angelo Husain",
  "Angelo Mendoza",
  "Anna Dominique Dimacali",
  "Anna Seo",
  "Annan Odongo",
  "Anne Murray Lorico",
  "Anthony Leonard Cavett",
  "Antonio Smith",
  "Arnulfo Montesclaros Jr",
  "Ashley Danica Barnuevo",
  "Austin Ferguson",
  "Baolin Henry Zhang",
  "Blake Shinn",
  "Bradley Hollowell",
  "Brandon Phillips",
  "Brye'shawn Butler",
  "Calvin Nguyen",
  "Cameron Forrest",
  "Cheska Timkang",
  "Chris Simpson",
  "Christian Andrews",
  "Christian Clark",
  "Chrisipher Kennelley",
  "Cleo Anne Lozano",
  "Cole Mushinsky",
  "Colleen Tac-on",
  "Cooper Shaffett",
  "Corey Cage",
  "Crystal Dziedzic",
  "Damon Ottley",
  "Daniela Mercado",
  "Danny Thornton",
  "Darion Lewis",
  "Darius Brown",
  "Darrin Stewart",
  "Darryel Burdette",
  "Daven Hodge",
  "David Lopez",
  "David Sims",
  "Demarkco Cody",
  "Deprece Harris",
  "Derious Nichols",
  "Derrick Sargent",
  "Dominic Holman",
  "Donna Oliveros",
  "Dustin Earls",
  "Dylan Lano",
  "Earl Eugene Anthony Napier",
  "Edward Lindsey",
  "Erick Guzman Juarez",
  "Farahnaz Qasemi",
  "Farris Bruce",
  "Francis John Rebosura",
  "Frederick Cabilao",
  "Gabriel Talley",
  "Garrett McCarley",
  "Geneva Calomarde",
  "Gerlyn Garcia",
  "Gerrell Berg",
  "Glaiza Marie Laurente",
  "Hunter Burch",
  "Ian Montesclaros",
  "Jacob Christopher Blackburn",
  "Jacob Reed",
  "Jacob Rhodes",
  "James Houston",
  "Jamie Easter",
  "Jason Bateman",
  "Jason Casey",
  "Javier Camel",
  "Jaylon Yarbrough",
  "Jayson Ricana",
  "Jeff Lucas",
  "Jenna Kim",
  "Jenny Boy Ibale",
  "Jenny Mahawan",
  "Jerich Leonard",
  "Jerwin Pineda",
  "Jeryan Luzano",
  "Jeselton Chu",
  "Jhon Norban Rulona",
  "Jo-Ann Lazarte",
  "Job Christian Alberto",
  "John Carl Cabahug",
  "John Carlo Bicaldo",
  "John Godfrey",
  "John Maverick Nieto",
  "John Oliver Degamo",
  "Johnathan Wesley Allen",
  "Jonathan Knox",
  "Jonathon Allen",
  "Jordan Brown",
  "Jordan Calendacion",
  "Jordan Davis",
  "Jordan Koetsier",
  "Jordan Stanley",
  "Joseph Wease",
  "Josh Malloch",
  "Joshua Rhinehart",
  "Joshua Silva",
  "Joshua Williamson",
  "Justin Alverez",
  "Justin Parker",
  "Justin Robertson",
  "Kemuel Tamayo",
  "Ken Ubay",
  "Kenny Shin",
  "Kevin Khaiphanliane",
  "Kolby Fleck",
  "Krista Griffiss",
  "Kurt Merckel",
  "Kyle Jomarc Sicat",
  "Lance Novak",
  "Lashamus Dowell",
  "Lauren Andrews",
  "Leo Sun",
  "Leon Terrell Marsh",
  "Lloyd Tombiga",
  "Lois Lezarda",
  "Lou Basco",
  "Ma. Kristina Cabural",
  "MaCzarina Lagumen",
  "Marc James",
  "Marie Frances Javier",
  "Marjorie Valdez",
  "Mark Marquez",
  "Mary Renfrow",
  "Mary Rose Labuanan",
  "MaryGrace Cosio",
  "Matt Simmons",
  "Matthew Mccrary",
  "Matthew Nichols",
  "Memphis Admin",
  "Mikkel Brown",
  "Moniecris Dumanao",
  "Mycha Landanganon",
  "Nashville Admin",
  "Nathan Napora",
  "Nathan Wagner",
  "Naveen Lakhani",
  "Nicole Noval",
  "Nocona Detten",
  "Patrick Tendero",
  "Percy Smith",
  "Raul Bayuyos Jr",
  "Reginald Stewart",
  "Renz Marion Casilao",
  "Rhona Lae Solivar",
  "Richelle Labajo",
  "Rico Shaw",
  "Robert Gregory",
  "Robyn Heredia",
  "Rochelle Ortiz",
  "Rocky Deles",
  "Rogie Oliveros",
  "Ryan Madison",
  "Ryder Tourere",
  "Sean Smith",
  "Seven Grinis",
  "Shane Marie Rebadomia",
  "Shannon Thomas",
  "Shiela Luciano",
  "Shiela Marie Estrellado",
  "Takiea Johnson",
  "Terry Davis",
  "Thaddaeus Springfield",
  "Troy Willis",
  "Tywon Ross",
  "Wincel Franz Carusca",
  "Zac Coisman",
  "Zachary Gonzalez",
  "Zakarya Moradi",
  "Zonate Grant",
];

const COVERED_TECHNICIAN_OPTIONS = TECHNICIAN_OPTIONS;

function toggleListValue(values: string[] | undefined, value: string) {
  const current = values ?? [];
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function checkboxToYN(checked: boolean): "Y" | "N" {
  return checked ? "Y" : "N";
}

function ynToCheckbox(value?: "Y" | "N") {
  return value === "Y";
}

function findLocationByName(locationRows: LocationRow[], locationName: string) {
  const normalizedLocationName = normalizeLocationKey(locationName);
  if (!normalizedLocationName) return null;

  return locationRows.find((row) => normalizeLocationKey(row.location) === normalizedLocationName) ?? DEFAULT_LOCATION_ROWS.find((row) => normalizeLocationKey(row.location) === normalizedLocationName) ?? null;
}

function applyOfficeLocationSelection(currentRow: LocationRow, officeLocation: string, locationRows: LocationRow[]) {
  const matchedLocation = findLocationByName(locationRows, officeLocation);
  if (!matchedLocation) {
    return {
      ...currentRow,
      officeLocation,
      location: officeLocation || currentRow.location,
    };
  }

  return {
    ...currentRow,
    id: currentRow.id || matchedLocation.id,
    location: matchedLocation.location,
    office: matchedLocation.office || matchedLocation.location,
    officeLocation: matchedLocation.location,
    address1: matchedLocation.address1,
    address2: matchedLocation.address2,
    city: matchedLocation.city,
    state: matchedLocation.state,
    zipCode: matchedLocation.zipCode,
    coordinates: matchedLocation.coordinates ?? currentRow.coordinates,
    phoneNo: matchedLocation.phoneNo,
    email: matchedLocation.email,
    defaultPartDist: matchedLocation.defaultPartDist,
    repTech: matchedLocation.repTech,
    availableDays: matchedLocation.availableDays ?? currentRow.availableDays,
    availableTimeSlot: matchedLocation.availableTimeSlot ?? currentRow.availableTimeSlot,
    checkProcessing: matchedLocation.checkProcessing ?? currentRow.checkProcessing,
    creditCardProcessing: matchedLocation.creditCardProcessing ?? currentRow.creditCardProcessing,
    permission: matchedLocation.permission ?? currentRow.permission,
    encompassPickupWH: matchedLocation.encompassPickupWH ?? currentRow.encompassPickupWH,
    coveredTechnicians: matchedLocation.coveredTechnicians ?? currentRow.coveredTechnicians,
    sms: matchedLocation.sms,
    emailFlag: matchedLocation.emailFlag,
    autoTriage: matchedLocation.autoTriage,
  };
}

function normalizeLocationKey(value: string) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildEmptyLocationRow(): LocationRow {
  return {
    id: "",
    legacyId: "",
    location: "",
    address1: "",
    address2: "",
    city: "",
    state: "",
    zipCode: "",
    office: "",
    coordinates: "",
    phoneNo: "",
    email: "",
    defaultPartDist: "",
    repTech: "",
    officeLocation: "",
    checkProcessing: "N",
    creditCardProcessing: "N",
    permission: "N",
    sms: "N",
    emailFlag: "N",
    autoTriage: "N",
    encompassPickupWH: "N",
    availableDays: [],
    availableTimeSlot: "ANY",
    coveredTechnicians: [],
    deliveryRecipientName: "",
    laborFee: "",
    partFee: "",
    tripFee: "",
    othersFee: "",
    oowPartActual: false,
  };
}

function buildEmptyCoverageRow(location = ""): CoverageRow {
  return {
    id: "",
    location,
    zipCode: "",
    city: "",
    selfSchedule: "",
    daysLater: "",
    tierCode: "",
  };
}

function parseCoverageCsv(csvText: string): CoverageRow[] {
  return csvText
    .split(/\r?\n/)
    .slice(1)
    .map((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return null;

      const match = trimmed.match(/^"([^"]*)","([^"]*)","([^"]*)","([^"]*)","([^"]*)"$/);
      if (!match) return null;

      const [, zipCode, city, location, selfSchedule, tierCode] = match;
      return {
        id: String(index + 1),
        zipCode,
        city,
        location,
        selfSchedule,
        daysLater: "",
        tierCode,
      } satisfies CoverageRow;
    })
    .filter((row): row is CoverageRow => Boolean(row));
}

function nextNumericId(rows: Array<{ id: string }>, fallbackStart: number) {
  const maxId = rows.reduce((max, row) => {
    const numericId = Number.parseInt(row.id, 10);
    return Number.isFinite(numericId) && numericId > max ? numericId : max;
  }, fallbackStart - 1);
  return String(maxId + 1);
}

const DEFAULT_LOCATION_ROWS: LocationRow[] = [
  { id: "1", location: "Memphis", address1: "3663 Cherry Rd", address2: "#101", city: "Memphis", state: "TN", zipCode: "38118", office: "Memphis", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Sean Smith", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "2", location: "Nashville", address1: "163 N MOUNT JULIET RD", address2: "", city: "Mount Juliet", state: "TN", zipCode: "37122", office: "Nashville", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Leo Sun", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "3", location: "Jacksonville", address1: "5913 Normandy Blvd", address2: "#11", city: "Jacksonville", state: "FL", zipCode: "32205", office: "Jacksonville", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Daven Hodge", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "6", location: "Tallahassee", address1: "5281 Tower Rd", address2: "B5", city: "Tallahassee", state: "FL", zipCode: "32303", office: "Tallahassee", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Matthew Mccrary", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "7", location: "Birmingham", address1: "631 Beacon Pkwy W", address2: "ste 106", city: "Birmingham", state: "AL", zipCode: "35209", office: "Birmingham", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass-Birmingham / Montgomery", repTech: "David Sims", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "8", location: "Huntsville", address1: "8207 Stephanie Dr SW", address2: "", city: "Huntsville", state: "AL", zipCode: "35802", office: "Huntsville", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Jordan Stanley", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "9", location: "Jonesboro", address1: "649 Burke Ave", address2: "", city: "Jonesboro", state: "AR", zipCode: "72401", office: "Jonesboro", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Erick Guzman Juarez", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "10", location: "Atlanta", address1: "2001 Lawrencevill-Suwanee rd", address2: "ste 104", city: "Suwanee", state: "GA", zipCode: "30024", office: "Atlanta", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Kevin Khaiphanliane", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "13", location: "Knoxville", address1: "3137 Lakemoor View Road", address2: "", city: "Knoxville", state: "TN", zipCode: "37920", office: "Knoxville", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Leo Sun", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "14", location: "Wilmington", address1: "108 N Kerr Ave", address2: "#2H", city: "Wilmington", state: "NC", zipCode: "28405", office: "Wilmington", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Brye'shawn Butler", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "20", location: "Mobile", address1: "3656 Government Blvd", address2: "ste E", city: "Mobile", state: "AL", zipCode: "36693", office: "Mobile", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Jonathon Allen", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "27", location: "Savannah", address1: "24 Commerce Place", address2: "Unit A", city: "Savannah", state: "GA", zipCode: "31406", office: "Savannah", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Lance Novak", sms: "Y", emailFlag: "N", autoTriage: "Y" },
  { id: "37", location: "Montgomery", address1: "1115C Perry hill rd", address2: "unit C", city: "Montgomery", state: "AL", zipCode: "36109", office: "Montgomery", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass-Birmingham / Montgomery", repTech: "Kenny Shin", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "39", location: "Chattanooga", address1: "5805 Lee Hwy", address2: "#307", city: "Chattanooga", state: "TN", zipCode: "37421", office: "Chattanooga", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Jonathon Allen", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "40", location: "Columbus", address1: "2013 Devonshire Dr", address2: "Ste 1200", city: "Columbus", state: "GA", zipCode: "31904", office: "Columbus", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Matt Simmons", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "41", location: "Jackson,MS", address1: "407 Briarwood Dr", address2: "Suites 210 A", city: "Jackson", state: "MS", zipCode: "39206", office: "Jackson,MS", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Lashamus Dowell", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "42", location: "Raleigh", address1: "313 US-70", address2: "Suite B", city: "Garner", state: "NC", zipCode: "27529", office: "Raleigh", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Alexxis Henry", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "43", location: "New Orleans", address1: "179 Belle Terre Blvd", address2: "Ste B", city: "Laplace", state: "LA", zipCode: "70068", office: "New Orleans", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Danny Thornton", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "45", location: "Louisville", address1: "3721 Tuscany Valley Dr", address2: "", city: "Louisville", state: "KY", zipCode: "40219", office: "Louisville", phoneNo: "", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "46", location: "St. Louis", address1: "11040 Lin Valle Dr,", address2: "Suite D", city: "St. Louis", state: "MO", zipCode: "63123", office: "St. Louis", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Derious Nichols", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "50", location: "Richmond", address1: "4501 Williamsburg Rd", address2: "Ste H", city: "Richmond", state: "VA", zipCode: "23231", office: "Richmond", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Zachary Gonzalez", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "51", location: "Jackson,TN", address1: "1903 N Highland Ave", address2: "Ste 10", city: "Jackson", state: "TN", zipCode: "38305", office: "Jackson,TN", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Brandon Phillips", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "52", location: "Asheville", address1: "3869 Sweeten Creek Rd", address2: "Ste C", city: "Arden", state: "NC", zipCode: "28704", office: "Asheville", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Daven Hodge", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "53", location: "Norfolk", address1: "1905 S Military Highway", address2: "Suite 110", city: "Chesapeake", state: "VA", zipCode: "23320", office: "Norfolk", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Chris Simpson", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "54", location: "Little Rock", address1: "11701 I-30", address2: "Suite 324", city: "Little Rock", state: "AR", zipCode: "72209", office: "Little Rock", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Danny Thornton", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "55", location: "Cape Girardeau", address1: "1204 Meadowbrook Dr", address2: "Suite 2", city: "Cape Girardeau", state: "MO", zipCode: "63703", office: "Cape Girardeau", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Matthew Nichols", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "56", location: "Destin", address1: "106 Eastview DR", address2: "", city: "Crestview", state: "FL", zipCode: "32536", office: "Destin", phoneNo: "8007793579", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Garrett McCarley", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "57", location: "San Antonio", address1: "817 I-35", address2: "", city: "San Marcos", state: "TX", zipCode: "78666", office: "San Antonio", phoneNo: "", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Erick Guzman Juarez", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "58", location: "Lake Charles", address1: "2619 Ruth St", address2: "", city: "Sulphur", state: "LA", zipCode: "70665", office: "Lake Charles", phoneNo: "", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Danny Thornton", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "59", location: "Dallas", address1: "4347 W Northwest Hwy", address2: "Suite 130, Box 114", city: "Dallas", state: "TX", zipCode: "75220", office: "Dallas", phoneNo: "", email: "naveen.lakhani@usinhomeservices.com", defaultPartDist: "Encompass", repTech: "Lashamus Dowell", sms: "Y", emailFlag: "N", autoTriage: "N" },
  { id: "60", location: "Philippines", address1: "", address2: "", city: "Philippines", state: "WY", zipCode: "", office: "Philippines", phoneNo: "", email: "", defaultPartDist: "", repTech: "", sms: "Y", emailFlag: "N", autoTriage: "N" },
];

export function getLocationManagementZoomAddress(location: string) {
  const normalizedLocation = normalizeLocationName(location);
  if (!normalizedLocation) return "";
  const normalizedLocationKey = normalizeLocationKey(normalizedLocation);

  const matchesLocation = (candidate: string) => normalizeLocationKey(candidate) === normalizedLocationKey;

  const raw = typeof window !== "undefined" ? window.localStorage.getItem(LOCATION_STORAGE_KEY) : null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { rows?: LocationRow[] };
      const savedRow = parsed.rows?.find((row) => matchesLocation(row.location));
      if (savedRow) {
        return [savedRow.address1, savedRow.address2, savedRow.city, savedRow.state, savedRow.zipCode, "USA"].filter(Boolean).join(", ") || savedRow.location;
      }
    } catch {
      // fall back to defaults below
    }
  }

  const defaultRow = DEFAULT_LOCATION_ROWS.find((row) => matchesLocation(row.location));
  if (defaultRow) {
    return [defaultRow.address1, defaultRow.address2, defaultRow.city, defaultRow.state, defaultRow.zipCode, "USA"].filter(Boolean).join(", ") || defaultRow.location;
  }

  return normalizedLocation;
}

/**
 * Parse a "lat, lng" coordinates string into a point. Returns null if the
 * string is blank or not a valid pair of numbers.
 */
export function parseCoordinates(coordinates?: string): { lat: number; lng: number } | null {
  if (!coordinates) return null;
  const parts = String(coordinates).split(",").map((p) => parseFloat(p.trim()));
  if (parts.length !== 2) return null;
  const [lat, lng] = parts;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/**
 * Return the explicit map coordinates for a location, if the user entered any
 * in Location Management. Returns null when none are set (callers should then
 * fall back to geocoding the address via getLocationManagementZoomAddress).
 */
export function getLocationManagementCoordinates(location: string): { lat: number; lng: number } | null {
  const normalizedLocation = normalizeLocationName(location);
  if (!normalizedLocation) return null;
  const normalizedLocationKey = normalizeLocationKey(normalizedLocation);
  const matchesLocation = (candidate: string) => normalizeLocationKey(candidate) === normalizedLocationKey;

  const raw = typeof window !== "undefined" ? window.localStorage.getItem(LOCATION_STORAGE_KEY) : null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { rows?: LocationRow[] };
      const savedRow = parsed.rows?.find((row) => matchesLocation(row.location));
      const fromSaved = parseCoordinates(savedRow?.coordinates);
      if (fromSaved) return fromSaved;
    } catch {
      // fall through to defaults
    }
  }

  const defaultRow = DEFAULT_LOCATION_ROWS.find((row) => matchesLocation(row.location));
  return parseCoordinates(defaultRow?.coordinates);
}

const DEFAULT_PART_ADDRESS_ROWS: PartAddressRow[] = [
  { id: "36", name: "Nashville", address1: "163 N MOUNT JULIET RD", address2: "", city: "Mount Juliet", state: "Tennessee", zipCode: "37122", location: "Nashville" },
  { id: "37", name: "Knoxville", address1: "5615 Poston Way", address2: "Apt 112", city: "Knoxville", state: "Tennessee", zipCode: "37918", location: "Tallahassee" },
  { id: "38", name: "Atlanta", address1: "2001 Lawrencevill-Suwanee rd", address2: "ste 104", city: "Suwanee", state: "Georgia", zipCode: "30024", location: "Atlanta" },
  { id: "39", name: "Jonesboro", address1: "649 Burke Ave", address2: "", city: "Jonesboro", state: "Arkansas", zipCode: "72401", location: "Jonesboro" },
  { id: "40", name: "Huntsville", address1: "8207 Stephanie Dr SW", address2: "", city: "Huntsville", state: "Alabama", zipCode: "35802", location: "Huntsville" },
  { id: "41", name: "Birmingham", address1: "631 Beacon Pkwy W", address2: "ste 106", city: "Birmingham", state: "Alabama", zipCode: "35209", location: "Birmingham" },
  { id: "42", name: "Tallahassee", address1: "5277 Tower rd", address2: "A2", city: "Tallahassee", state: "Florida", zipCode: "32303", location: "Tallahassee" },
  { id: "43", name: "Jacksonville", address1: "3728 Philips Hwy", address2: "ste 41", city: "Jacksonville", state: "Florida", zipCode: "32207", location: "Jacksonville" },
  { id: "44", name: "Memphis", address1: "3663 Cherry Rd", address2: "#101", city: "Memphis", state: "Tennessee", zipCode: "38118", location: "Memphis" },
  { id: "45", name: "Savannah", address1: "2800 capital st", address2: "26b", city: "Savannah", state: "Georgia", zipCode: "31404", location: "Savannah" },
  { id: "46", name: "Mobile", address1: "3656 Government Blvd", address2: "ste E", city: "Mobile", state: "Alabama", zipCode: "36693", location: "Mobile" },
  { id: "47", name: "Wilmington", address1: "4516 Tesla park dr", address2: "Apt 302", city: "Wilmington", state: "North Carolina", zipCode: "28412", location: "Wilmington" },
];

const DEFAULT_COVERAGE_ROWS: CoverageRow[] = [
  ...Object.entries(coverageCsvModules).flatMap(([filePath, csvText], fileIndex) => {
    const locationOffset = fileIndex * 10000;
    return parseCoverageCsv(csvText).map((row, rowIndex) => {
      // Normalise the location to the canonical form so it matches
      // entries in src/lib/locations.ts (and the dropdown options the
      // app builds from it). The CSV files use slightly different
      // spellings — "Jackson,TN" vs "Jackson, TN" — and the filename
      // fallback comes in lowercased. Run both through normalizeLocationName.
      const filenameFallback = filePath
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.csv$/i, "")
        // Title-case each space-separated word: "new orleans" -> "New Orleans"
        ?.split(" ")
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
        .join(" ")
        ?? "";
      const rawLocation = row.location || filenameFallback;
      const normalised = normalizeLocationName(rawLocation);
      return {
        ...row,
        id: String(locationOffset + rowIndex + 1),
        location: normalised,
      };
    });
  }),
];

function loadRows<T>(key: string, fallback: T[]) {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as { rows?: T[] };
    return Array.isArray(parsed.rows) ? parsed.rows : fallback;
  } catch {
    return fallback;
  }
}

function saveRows<T>(key: string, rows: T[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify({ rows }));
}

function matchesQuery(values: Array<string | number | undefined>, query: string) {
  if (!query) return true;
  return values.join(" ").toLowerCase().includes(query);
}

function resolveCoverageLocation(query: string, locationRows: LocationRow[], coverageRows: CoverageRow[]) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return "";

  const locationMatch = locationRows.find((row) => row.location.toLowerCase().includes(normalizedQuery));
  if (locationMatch) return locationMatch.location;

  const coverageMatch = coverageRows.find((row) => row.location.toLowerCase().includes(normalizedQuery));
  return coverageMatch?.location ?? "";
}

export function LocationManagementPage({ sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [activeTab, setActiveTab] = useState<"locations" | "parts" | "coverage">("locations");
  
  // Helper function to deduplicate locations by name.
  // Prefers a real persisted DB row (uuid id) over a hardcoded default, and
  // among DB rows prefers one that has coordinates set. This keeps the uuid so
  // subsequent edits UPDATE the existing row instead of inserting a duplicate.
  const isUuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

  const pickBetterLocationRow = (a: LocationRow, b: LocationRow): LocationRow => {
    const aUuid = isUuid(a.id);
    const bUuid = isUuid(b.id);
    if (aUuid !== bUuid) return aUuid ? a : b; // prefer persisted row
    const aHasCoords = Boolean((a.coordinates || "").trim());
    const bHasCoords = Boolean((b.coordinates || "").trim());
    if (aHasCoords !== bHasCoords) return aHasCoords ? a : b; // prefer with coords
    return a; // keep first seen otherwise
  };

  const deduplicateLocations = (rows: LocationRow[]): LocationRow[] => {
    const byName = new Map<string, LocationRow>();
    const order: string[] = [];

    for (const row of rows) {
      const key = normalizeLocationKey(row.location);
      if (!byName.has(key)) {
        byName.set(key, row);
        order.push(key);
      } else {
        byName.set(key, pickBetterLocationRow(byName.get(key)!, row));
      }
    }

    return order.map((key) => byName.get(key)!);
  };
  
  const [locationRows, setLocationRows] = useState<LocationRow[]>(() => {
    const rows = loadRows(LOCATION_STORAGE_KEY, DEFAULT_LOCATION_ROWS);
    return deduplicateLocations(rows);
  });
  const [partRows, setPartRows] = useState<PartAddressRow[]>(() => loadRows(PART_ADDRESS_STORAGE_KEY, DEFAULT_PART_ADDRESS_ROWS));
  const [coverageRows, setCoverageRows] = useState<CoverageRow[]>(() => loadRows(COVERAGE_STORAGE_KEY, DEFAULT_COVERAGE_ROWS));

  // Real technician roster pulled from Supabase profiles (company-scoped via
  // RLS). Drives the "Covered Technicians" check list on the Edit Location
  // modal so the names that get ticked map to actual users — and lets us sync
  // their `assigned_branch` when the row is saved.
  const [technicianRoster, setTechnicianRoster] = useState<Array<{ id: string; name: string; assignedBranch: string | null }>>([]);

  const { companyId, ready: authReady } = useAuth();

  // Load location-management data from Supabase (company-scoped). On the very
  // first load for a company (empty tables), seed the DEFAULT rows so existing
  // setups aren't lost, then everything persists to Supabase going forward.
  useEffect(() => {
    if (!authReady || !companyId) return;
    let cancelled = false;
    (async () => {
      try {
        let [locs, parts, cov] = await Promise.all([
          sbGetLocations(),
          sbGetPartAddresses(),
          sbGetCoverage(),
        ]);

        console.log("📍 Location mgmt loaded from Supabase:", {
          locations: locs.length,
          partAddresses: parts.length,
          coverage: cov.length,
          defaultCoverageAvailable: DEFAULT_COVERAGE_ROWS.length,
        });

        // Seed defaults once if empty.
        if (locs.length === 0) {
          for (const row of deduplicateLocations(DEFAULT_LOCATION_ROWS)) {
            try { await sbUpsertLocation(row); } catch (e) { console.error("seed location failed:", e); }
          }
          locs = await sbGetLocations();
        }
        if (parts.length === 0) {
          for (const row of DEFAULT_PART_ADDRESS_ROWS) {
            try { await sbUpsertPartAddress(row); } catch (e) { console.error("seed part addr failed:", e); }
          }
          parts = await sbGetPartAddresses();
        }
        if (cov.length === 0 && DEFAULT_COVERAGE_ROWS.length > 0) {
          console.log(`📍 Seeding ${DEFAULT_COVERAGE_ROWS.length} coverage rows into Supabase...`);
          // Coverage can be large; bulk insert in chunks.
          const chunkSize = 500;
          let inserted = 0;
          for (let i = 0; i < DEFAULT_COVERAGE_ROWS.length; i += chunkSize) {
            try {
              const saved = await sbInsertCoverageBulk(DEFAULT_COVERAGE_ROWS.slice(i, i + chunkSize));
              inserted += saved.length;
            } catch (e) {
              console.error("seed coverage chunk failed:", e);
            }
          }
          console.log(`📍 Coverage seed complete: ${inserted} rows inserted.`);
          cov = await sbGetCoverage();
        } else if (DEFAULT_COVERAGE_ROWS.length > 0) {
          // Top-up: if some branches are present in Supabase but others
          // are missing (e.g. the original seed pre-dated newer CSVs),
          // insert only the missing branches' rows. Compare by normalised
          // location name so "Jackson, MS" matches "Jackson,MS".
          const presentByLocation = new Set(
            cov.map((r) => normalizeLocationName(r.location).toLowerCase()),
          );
          const missingRows = DEFAULT_COVERAGE_ROWS.filter(
            (r) => !presentByLocation.has(normalizeLocationName(r.location).toLowerCase()),
          );
          if (missingRows.length > 0) {
            const missingBranches = Array.from(
              new Set(missingRows.map((r) => normalizeLocationName(r.location))),
            ).join(", ");
            console.log(`📍 Topping up coverage for missing branches (${missingRows.length} rows): ${missingBranches}`);
            const chunkSize = 500;
            let inserted = 0;
            for (let i = 0; i < missingRows.length; i += chunkSize) {
              try {
                const saved = await sbInsertCoverageBulk(missingRows.slice(i, i + chunkSize));
                inserted += saved.length;
              } catch (e) {
                console.error("top-up coverage chunk failed:", e);
              }
            }
            console.log(`📍 Coverage top-up complete: ${inserted} rows inserted.`);
            cov = await sbGetCoverage();
          }
        }

        if (!cancelled) {
          if (locs.length) {
            // Clean up any duplicate DB rows (same location name) created by the
            // old dedup logic: keep the best row per name, delete the rest.
            const keep = new Map<string, LocationRow>();
            const toDelete: string[] = [];
            for (const row of locs) {
              const key = normalizeLocationKey(row.location);
              const existing = keep.get(key);
              if (!existing) {
                keep.set(key, row);
              } else {
                const better = pickBetterLocationRow(existing, row);
                keep.set(key, better);
                const loser = better === existing ? row : existing;
                if (isUuid(loser.id)) toDelete.push(loser.id);
              }
            }
            if (toDelete.length) {
              await Promise.all(
                toDelete.map((id) => sbDeleteLocation(id).catch((e) => console.error("dedup delete failed:", e)))
              );
            }
            const cleaned = deduplicateLocations(Array.from(keep.values()));
            setLocationRows(cleaned);
            // Mirror to localStorage so map helpers (getLocationManagement*)
            // and other pages that read the cache stay in sync with Supabase.
            saveRows(LOCATION_STORAGE_KEY, cleaned);
          }
          if (parts.length) setPartRows(parts);
          if (cov.length) setCoverageRows(cov);
        }
      } catch (err) {
        console.error("Location management load failed:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [authReady, companyId]);

  // Fetch the company's technician roster (TECHNICIAN as primary role OR in
  // extra_roles — so multi-role users like Daven Hodge surface as well).
  // Powers the "Covered Technicians" check list in the Edit Location modal.
  useEffect(() => {
    if (!authReady || !companyId) return;
    let cancelled = false;
    (async () => {
      try {
        const { getCompanyUsers } = await import("@/lib/supabase/users");
        const profiles = await getCompanyUsers();
        if (cancelled) return;
        const techs = profiles
          .filter((p) => {
            const primary = String(p.role || "").toUpperCase();
            if (primary === "TECHNICIAN") return true;
            const extras = (p as any).extra_roles as string[] | null | undefined;
            return Array.isArray(extras) && extras.some((r) => String(r).toUpperCase() === "TECHNICIAN");
          })
          .map((p) => ({
            id: p.id,
            name: p.display_name || p.username || p.email,
            assignedBranch: p.assigned_branch ?? null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setTechnicianRoster(techs);
      } catch (err) {
        console.error("Load technician roster failed:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [authReady, companyId]);

  const [locationSearch, setLocationSearch] = useState("");
  const [partSearch, setPartSearch] = useState("");
  const [coverageSearch, setCoverageSearch] = useState("");
  const [showZipLabels, setShowZipLabels] = useState(true);
  const [newLocationRow, setNewLocationRow] = useState<LocationRow>(() => buildEmptyLocationRow());
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [newPartRow, setNewPartRow] = useState<PartAddressRow>({ id: "", name: "", address1: "", address2: "", city: "", state: "", zipCode: "", location: "" });
  const [newCoverageRow, setNewCoverageRow] = useState<CoverageRow>(() => buildEmptyCoverageRow());
  const [selectedCoverageLocation, setSelectedCoverageLocation] = useState(() => DEFAULT_COVERAGE_ROWS[0]?.location ?? locationRows[0]?.location ?? "Birmingham");
  const [coverageMapReady, setCoverageMapReady] = useState(false);
  const [coverageMapLoading, setCoverageMapLoading] = useState(false);
  const [coverageMapError, setCoverageMapError] = useState<string | null>(null);
  const nextLocationId = nextNumericId(locationRows, 1);
  const nextPartAddressId = nextNumericId(partRows, 36);
  const nextCoverageId = nextNumericId(coverageRows, 1);
  const coverageMapContainerRef = useRef<HTMLDivElement | null>(null);
  const coverageMapRef = useRef<any>(null);
  const coverageGeocodeCacheRef = useRef(new Map<string, MapZipGeometry | null>());
  const coverageZipGeoJsonCacheRef = useRef(new Map<string, CoverageZipGeoJson | null>());
  const coverageOverlayRefs = useRef<any[]>([]);

  const filteredLocations = useMemo(() => {
    const query = locationSearch.trim().toLowerCase();
    return locationRows.filter((row) =>
      matchesQuery([
        row.id,
        row.location,
        row.address1,
        row.address2,
        row.city,
        row.state,
        row.zipCode,
        row.office,
        row.phoneNo,
        row.email,
        row.defaultPartDist,
        row.repTech,
        row.sms,
        row.emailFlag,
        row.autoTriage,
      ], query),
    );
  }, [locationRows, locationSearch]);

  const filteredPartRows = useMemo(() => {
    const query = partSearch.trim().toLowerCase();
    return partRows.filter((row) =>
      matchesQuery([row.id, row.name, row.address1, row.address2, row.city, row.state, row.zipCode, row.location], query),
    );
  }, [partRows, partSearch]);

  const filteredCoverageRows = useMemo(() => {
    const query = coverageSearch.trim().toLowerCase();
    // Compare location loosely so DB rows like "Memphis " or "memphis" still
    // match a "Memphis" dropdown pick.
    const norm = (v: string | null | undefined) =>
      normalizeLocationName(String(v ?? "")).toLowerCase();
    const target = norm(selectedCoverageLocation);
    const fromSupabase = coverageRows.filter(
      (row) => norm(row.location) === target &&
        matchesQuery([row.id, row.zipCode, row.city, row.location, row.selfSchedule, row.daysLater, row.tierCode], query),
    );
    if (fromSupabase.length > 0 || !target) return fromSupabase;
    // Fall back to bundled CSV rows if Supabase has nothing for this branch.
    return DEFAULT_COVERAGE_ROWS.filter(
      (row) => norm(row.location) === target &&
        matchesQuery([row.id, row.zipCode, row.city, row.location, row.selfSchedule, row.daysLater, row.tierCode], query),
    );
  }, [coverageRows, coverageSearch, selectedCoverageLocation]);

  const selectedLocationRow = useMemo(
    () => findLocationByName(locationRows, newLocationRow.officeLocation || newLocationRow.location),
    [locationRows, newLocationRow.location, newLocationRow.officeLocation],
  );

  const visibleLocationId = selectedLocationRow?.legacyId || selectedLocationRow?.id || newLocationRow.legacyId || editingLocationId || nextLocationId;

  const coverageLocationOptions = useMemo(() => {
    const locations = new Set<string>();

    // A location name must contain at least one letter and not look like
    // a zip code. This protects against old CSV imports where columns
    // shifted and zip-code numbers leaked into the location column.
    const isCleanLocationName = (raw: string) => {
      const v = String(raw ?? "").trim();
      if (!v) return false;
      if (!/[A-Za-z]/.test(v)) return false; // must contain a letter
      if (/^\d{3,}/.test(v)) return false;   // starts with digits (likely zip)
      if (v.length > 40) return false;       // unrealistically long
      return true;
    };

    // 1. Start from the canonical LOCATIONS constant — this is the
    //    authoritative list of branches and never contains garbage.
    for (const name of LOCATIONS) {
      locations.add(normalizeLocationName(name));
    }

    // 2. Include any branch the user has added in the Locations tab
    //    that isn't in the canonical list yet (still must pass the
    //    cleanliness check).
    for (const row of locationRows) {
      if (isCleanLocationName(row.location)) {
        locations.add(normalizeLocationName(row.location));
      }
    }

    // 3. Keep whatever the user just selected so the <select> renders
    //    the current value even if it's brand-new.
    const selectedLocation = selectedCoverageLocation.trim();
    if (isCleanLocationName(selectedLocation)) {
      locations.add(normalizeLocationName(selectedLocation));
    }

    return Array.from(locations).sort((left, right) => left.localeCompare(right));
  }, [locationRows, selectedCoverageLocation]);

  useEffect(() => {
    if (activeTab !== "coverage") return;
    const matchedLocation = resolveCoverageLocation(locationSearch, locationRows, coverageRows);
    if (matchedLocation && matchedLocation !== selectedCoverageLocation) {
      setSelectedCoverageLocation(matchedLocation);
      setNewCoverageRow((current) => ({ ...current, location: matchedLocation }));
    }
  }, [activeTab, coverageRows, locationRows, locationSearch, selectedCoverageLocation]);

  useEffect(() => {
    if (!selectedCoverageLocation) return;
    setNewCoverageRow((current) => (current.location === selectedCoverageLocation ? current : { ...current, location: selectedCoverageLocation }));
  }, [selectedCoverageLocation]);

  useEffect(() => {
    if (!selectedCoverageLocation) return;
    setNewLocationRow((current) => applyOfficeLocationSelection(current, selectedCoverageLocation, locationRows));
  }, [locationRows, selectedCoverageLocation]);

  useEffect(() => {
    if (!selectedLocationRow) return;
    setNewLocationRow((current) => {
      if (current.location === selectedLocationRow.location && current.officeLocation === selectedLocationRow.location) {
        return current;
      }
      return applyOfficeLocationSelection(current, selectedLocationRow.location, locationRows);
    });
    // Don't sync the coverage selection from the Locations form when the
    // user is already viewing the Coverage tab — they may have just
    // clicked a per-row "Zip Codes" button which set selectedCoverage to
    // a different location. Letting this effect override would yank them
    // back to whatever the form has. Only sync while still on the
    // Locations tab.
    if (activeTab !== "coverage" && selectedCoverageLocation !== selectedLocationRow.location) {
      setSelectedCoverageLocation(selectedLocationRow.location);
    }
  }, [activeTab, locationRows, selectedCoverageLocation, selectedLocationRow]);

  const selectedLocationCoverage = useMemo(
    () => {
      const norm = (v: string | null | undefined) =>
        normalizeLocationName(String(v ?? "")).toLowerCase();
      const target = norm(selectedCoverageLocation);
      if (!target) return [] as CoverageRow[];
      const fromSupabase = coverageRows.filter((row) => norm(row.location) === target);
      if (fromSupabase.length > 0) return fromSupabase;
      // Fall back to the CSVs bundled with the app so the map still
      // draws polygons when Supabase is missing rows for a branch
      // (e.g. the original seed pre-dated newer CSVs, or the row
      // got stored under a slightly different spelling).
      return DEFAULT_COVERAGE_ROWS.filter((row) => norm(row.location) === target);
    },
    [coverageRows, selectedCoverageLocation],
  );

  const minimumReadableZoom = selectedCoverageLocation === "Memphis" ? 6 : 7;

  useEffect(() => {
    if (activeTab !== "coverage") return;

    if (!GOOGLE_MAPS_API_KEY) {
      setCoverageMapError("Set VITE_GOOGLE_MAPS_API_KEY to enable the Google coverage map.");
      return;
    }

    let cancelled = false;

    const initializeMap = () => {
      if (cancelled || !coverageMapContainerRef.current) return;
      const maps = (window as Window & { google?: any }).google?.maps;
      if (!maps) return;

      const MapConstructor = maps.Map;
      const mapTypeId = maps.MapTypeId?.ROADMAP ?? "roadmap";

      if (typeof MapConstructor !== "function") {
        if (!cancelled) setCoverageMapError("Google Maps did not expose a Map constructor.");
        return;
      }

      // Always re-create the map if the container div has changed (tab remount)
      if (
        !coverageMapRef.current ||
        coverageMapRef.current.getDiv() !== coverageMapContainerRef.current
      ) {
        coverageMapRef.current = new MapConstructor(coverageMapContainerRef.current, {
          center: { lat: 37.0902, lng: -95.7129 },
          zoom: 4,
          mapTypeId,
          disableDefaultUI: false,
          zoomControl: true,
          mapTypeControl: true,
          gestureHandling: "greedy",
        });
      }

      if (!cancelled) {
        setCoverageMapReady(true);
        setCoverageMapError(null);
      }
    };

    const existingScript = document.querySelector<HTMLScriptElement>('script[data-google-maps="location-coverage"]');
    if ((window as Window & { google?: any }).google?.maps) {
      initializeMap();
    } else if (existingScript) {
      (window as Window & { initCoverageMap?: () => void }).initCoverageMap = initializeMap;
      existingScript.addEventListener(
        "error",
        () => {
          if (!cancelled) setCoverageMapError("Google Maps failed to load.");
        },
        { once: true },
      );
    } else {
      (window as Window & { initCoverageMap?: () => void }).initCoverageMap = initializeMap;
      const script = document.createElement("script");
      script.dataset.googleMaps = "location-coverage";
      script.async = true;
      script.defer = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&loading=async&v=weekly&callback=initCoverageMap`;
      script.onerror = () => {
        if (!cancelled) setCoverageMapError("Google Maps failed to load.");
      };
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      // Reset so map re-attaches correctly on next tab visit
      coverageMapRef.current = null;
      setCoverageMapReady(false);
      delete (window as Window & { initCoverageMap?: () => void }).initCoverageMap;
    };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "coverage" || !coverageMapReady || !coverageMapRef.current) return;

    const maps = (window as Window & { google?: any }).google?.maps;
    if (!maps) return;

    coverageOverlayRefs.current.forEach((overlay) => overlay.setMap(null));
    coverageOverlayRefs.current = [];

    const mapData = coverageMapRef.current.data as any;
    mapData.forEach((feature: any) => mapData.remove(feature));

    let cancelled = false;
    const bounds = new maps.LatLngBounds();
    const geocoder = new maps.Geocoder();

    const geocodeZip = (zipCode: string) =>
      new Promise<MapZipGeometry | null>((resolve) => {
        geocoder.geocode({ address: `${zipCode}, USA` }, (results: any, status: string) => {
          if (status === "OK" && results?.[0]?.geometry?.location) {
            const location = results[0].geometry.location;
            const viewport = results[0].geometry.viewport;
            resolve({
              center: { lat: location.lat(), lng: location.lng() },
              viewport: viewport
                ? {
                    north: viewport.getNorthEast().lat(),
                    east: viewport.getNorthEast().lng(),
                    south: viewport.getSouthWest().lat(),
                    west: viewport.getSouthWest().lng(),
                  }
                : null,
            });
            return;
          }
          resolve(null);
        });
      });

    const fetchZipPoint = async (zipCode: string): Promise<MapZipGeometry | null> => {
      if (coverageGeocodeCacheRef.current.has(zipCode)) {
        return coverageGeocodeCacheRef.current.get(zipCode) ?? null;
      }
      // Check Supabase persistent cache first — free and instant
      const addr = `${zipCode}, USA`;
      const cached = await lookupGeocode(addr);
      if (cached) {
        const point: MapZipGeometry = { center: cached, viewport: null };
        coverageGeocodeCacheRef.current.set(zipCode, point);
        return point;
      }
      // Miss — call Google Geocoding API
      const point = await geocodeZip(zipCode);
      // Persist to Supabase so we never pay for this zip again
      if (point) void storeGeocode(addr, point.center);
      coverageGeocodeCacheRef.current.set(zipCode, point);
      return point;
    };

    const fetchZipGeoJson = async (zipCode: string): Promise<CoverageZipGeoJson | null> => {
      if (coverageZipGeoJsonCacheRef.current.has(zipCode)) {
        return coverageZipGeoJsonCacheRef.current.get(zipCode) ?? null;
      }

      try {
        const where = encodeURIComponent(`ZCTA5='${zipCode}'`);
        const url =
          "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/84/query" +
          `?where=${where}&outFields=ZCTA5&returnGeometry=true&f=geojson&outSR=4326`;
        const response = await fetch(url);
        if (!response.ok) {
          coverageZipGeoJsonCacheRef.current.set(zipCode, null);
          return null;
        }

        const geojson = (await response.json()) as CoverageZipGeoJson;
        const result = Array.isArray(geojson.features) && geojson.features.length > 0 ? geojson : null;
        coverageZipGeoJsonCacheRef.current.set(zipCode, result);
        return result;
      } catch {
        coverageZipGeoJsonCacheRef.current.set(zipCode, null);
        return null;
      }
    };

    const uniqueZipCodes = Array.from(
      new Set(selectedLocationCoverage.map((row) => String(row.zipCode || "").trim()).filter(Boolean)),
    );

    const fillPalette = [
      "#2d6a4f",
      "#40916c",
      "#1b4332",
      "#52796f",
      "#2f855a",
      "#3f8f7a",
    ];

    setCoverageMapLoading(true);
    setCoverageMapError(null);

    mapData.setStyle((feature: any) => {
      const zip = String(feature.getProperty("ZCTA5") ?? "");
      const index = uniqueZipCodes.indexOf(zip);
      const fillColor = fillPalette[(index >= 0 ? index : 0) % fillPalette.length];
      return {
        fillColor,
        fillOpacity: 0.35,
        strokeColor: "#0f172a",
        strokeOpacity: 0.6,
        strokeWeight: 1,
      };
    });

    if (!uniqueZipCodes.length) {
      setCoverageMapLoading(false);
      coverageMapRef.current.setCenter({ lat: 37.0902, lng: -95.7129 });
      coverageMapRef.current.setZoom(4);
      setCoverageMapError("No geocodable zip codes found for this location.");
      return () => {
        cancelled = true;
        coverageOverlayRefs.current.forEach((overlay) => overlay.setMap(null));
        coverageOverlayRefs.current = [];
        mapData.forEach((feature: any) => mapData.remove(feature));
      };
    }

    let pendingZipCount = uniqueZipCodes.length;
    let hasAnyValidPoints = false;

    uniqueZipCodes.forEach((zipCode, index) => {
      void (async () => {
        const [point, geojson] = await Promise.all([fetchZipPoint(zipCode), fetchZipGeoJson(zipCode)]);
        if (cancelled || !coverageMapRef.current) return;

        if (point) {
          hasAnyValidPoints = true;
          bounds.extend(point.center);

          // Plot a clickable, label-only marker at the centroid of every
          // zip so dispatchers can read which polygon is which without
          // hovering. A transparent 1×1 PNG keeps the marker invisible;
          // the `label` carries the zip code text directly. We push the
          // marker onto coverageOverlayRefs so the next render clears it.
          try {
            const marker = new maps.Marker({
              position: point.center,
              map: coverageMapRef.current,
              clickable: false,
              visible: showZipLabels,
              icon: {
                // 1×1 transparent gif — keeps the marker dot from rendering
                // while still letting Google Maps position the label.
                url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
                scaledSize: new maps.Size(1, 1),
                anchor: new maps.Point(0, 0),
                labelOrigin: new maps.Point(0, 0),
              },
              label: {
                text: zipCode,
                color: "#0f172a",
                fontSize: "11px",
                fontWeight: "700",
                className: "coverage-zip-label",
              },
              zIndex: 1000,
            });
            coverageOverlayRefs.current.push(marker);
          } catch (err) {
            // Marker overlay is purely decorative — if Google Maps refuses
            // it (e.g. AdvancedMarker migration), the polygon still renders.
            console.warn(`coverage zip label failed for ${zipCode}:`, err);
          }
        }

        if (geojson) {
          mapData.addGeoJson(geojson);
        }

        pendingZipCount -= 1;

        // On first resolved point, immediately zoom to the area so the map isn't blank
        if (index === 0 && point) {
          coverageMapRef.current.setCenter(point.center);
          coverageMapRef.current.setZoom(Math.max(minimumReadableZoom, 8));
        }

        if (pendingZipCount === 0) {
          setCoverageMapLoading(false);
          if (hasAnyValidPoints && !bounds.isEmpty()) {
            coverageMapRef.current.fitBounds(bounds, { padding: 40 });
            maps.event.addListenerOnce(coverageMapRef.current, "idle", () => {
              if (!coverageMapRef.current) return;
              const currentZoom = coverageMapRef.current.getZoom?.();
              if (typeof currentZoom === "number" && currentZoom < minimumReadableZoom) {
                coverageMapRef.current.setZoom(minimumReadableZoom);
              }
            });
          } else {
            coverageMapRef.current.setCenter({ lat: 37.0902, lng: -95.7129 });
            coverageMapRef.current.setZoom(4);
            setCoverageMapError("No geocodable zip codes found for this location.");
          }
        }
      })();
    });

    return () => {
      cancelled = true;
      coverageOverlayRefs.current.forEach((overlay) => overlay.setMap(null));
      coverageOverlayRefs.current = [];
      mapData.forEach((feature: any) => mapData.remove(feature));
    };
  }, [activeTab, coverageMapReady, minimumReadableZoom, selectedLocationCoverage, coverageGeocodeCacheRef, coverageMapRef, coverageOverlayRefs, coverageZipGeoJsonCacheRef, selectedCoverageLocation]);

  // Toggle the zip-code labels on/off without rebuilding the map. The map
  // effect above tracks every label marker in coverageOverlayRefs; we just
  // call setVisible() on each. setMap() would also work but setVisible
  // keeps the marker attached so flipping back is instant.
  useEffect(() => {
    coverageOverlayRefs.current.forEach((overlay) => {
      if (typeof overlay?.setVisible === "function") {
        overlay.setVisible(showZipLabels);
      }
    });
  }, [showZipLabels]);

  const addLocationRow = () => {
    if (!newLocationRow.location.trim()) return;
    const nextRow = {
      ...newLocationRow,
      id: editingLocationId ?? nextLocationId,
      officeLocation: newLocationRow.officeLocation || newLocationRow.location,
      availableDays: newLocationRow.availableDays ?? [],
      availableTimeSlot: newLocationRow.availableTimeSlot ?? "ANY",
      coveredTechnicians: newLocationRow.coveredTechnicians ?? [],
    };

    // Persist to Supabase, then reflect the saved row (with its real id) in UI.
    (async () => {
      try {
        const saved = await sbUpsertLocation(nextRow);
        setLocationRows((current) => {
          const updated = editingLocationId
            ? current.map((row) => (row.id === editingLocationId ? saved : row))
            : [saved, ...current];
          // Keep the localStorage cache in sync for the map helpers.
          saveRows(LOCATION_STORAGE_KEY, updated);
          return updated;
        });

        // Sync the assigned_branch on the profiles for every ticked technician
        // so they show up as "from this branch" everywhere else in the app
        // (Work Map, Mobile Tech roster, Ticket List branch filter, etc.).
        try {
          const branchName = saved.location || nextRow.location;
          const tickedNames = new Set(nextRow.coveredTechnicians ?? []);
          if (branchName && tickedNames.size > 0) {
            const { updateCompanyUser } = await import("@/lib/supabase/users");
            const targets = technicianRoster.filter(
              (t) => tickedNames.has(t.name) && t.assignedBranch !== branchName,
            );
            await Promise.all(
              targets.map((t) =>
                updateCompanyUser(t.id, { assignedBranch: branchName }).catch((e) =>
                  console.warn(`Sync assigned_branch failed for ${t.name}:`, e),
                ),
              ),
            );
            // Refresh local roster so the UI reflects the new assignment.
            if (targets.length > 0) {
              setTechnicianRoster((prev) =>
                prev.map((t) =>
                  tickedNames.has(t.name) ? { ...t, assignedBranch: branchName } : t,
                ),
              );
            }
          }
        } catch (e) {
          console.warn("Tech branch sync skipped:", e);
        }
      } catch (err) {
        console.error("Save location failed:", err);
        alert(`Failed to save location: ${err instanceof Error ? err.message : "Unknown error"}`);
        return;
      }
      setNewLocationRow(buildEmptyLocationRow());
      setEditingLocationId(null);
      setLocationModalOpen(false);
    })();
  };

  const editLocationRow = (row: LocationRow) => {
    setEditingLocationId(row.id);
    setNewLocationRow({
      ...buildEmptyLocationRow(),
      ...row,
      officeLocation: row.officeLocation || row.office || row.location,
      availableDays: row.availableDays ?? [],
      availableTimeSlot: row.availableTimeSlot ?? "ANY",
      coveredTechnicians: row.coveredTechnicians ?? [],
      checkProcessing: row.checkProcessing ?? "N",
      creditCardProcessing: row.creditCardProcessing ?? "N",
      permission: row.permission ?? "N",
      encompassPickupWH: row.encompassPickupWH ?? "N",
    });
    setSelectedCoverageLocation(row.location);
    setActiveTab("locations");
    setLocationModalOpen(true);
  };

  const resetLocationForm = () => {
    setNewLocationRow(buildEmptyLocationRow());
    setEditingLocationId(null);
  };

  const openNewLocationModal = () => {
    resetLocationForm();
    setLocationModalOpen(true);
  };

  const closeLocationModal = () => {
    setLocationModalOpen(false);
    resetLocationForm();
  };

  const deleteLocationRow = () => {
    if (!editingLocationId) return;
    if (confirm("Are you sure you want to delete this location?")) {
      removeLocationRow(editingLocationId);
      closeLocationModal();
    }
  };

  const addPartRow = () => {
    if (!newPartRow.name.trim()) return;
    const draft = { ...newPartRow, id: nextPartAddressId };
    (async () => {
      try {
        const saved = await sbUpsertPartAddress(draft);
        setPartRows((current) => [...current, saved]);
        setNewPartRow({ id: "", name: "", address1: "", address2: "", city: "", state: "", zipCode: "", location: "" });
      } catch (err) {
        console.error("Save part address failed:", err);
        alert(`Failed to save part address: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    })();
  };

  const addCoverageRow = () => {
    if (!newCoverageRow.zipCode.trim()) return;
    const draft = { ...newCoverageRow, id: nextCoverageId, location: selectedCoverageLocation || newCoverageRow.location };
    (async () => {
      try {
        const saved = await sbUpsertCoverage(draft);
        setCoverageRows((current) => [...current, saved]);
        setNewCoverageRow(buildEmptyCoverageRow(selectedCoverageLocation));
      } catch (err) {
        console.error("Save coverage failed:", err);
        alert(`Failed to save coverage: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    })();
  };

  const removeLocationRow = (rowId: string) => {
    setLocationRows((current) => current.filter((row) => row.id !== rowId));
    sbDeleteLocation(rowId).catch((err) => console.error("Delete location failed:", err));
  };
  const removePartRow = (rowId: string) => {
    setPartRows((current) => current.filter((row) => row.id !== rowId));
    sbDeletePartAddress(rowId).catch((err) => console.error("Delete part address failed:", err));
  };
  const removeCoverageRow = (rowId: string) => {
    setCoverageRows((current) => current.filter((row) => row.id !== rowId));
    sbDeleteCoverage(rowId).catch((err) => console.error("Delete coverage failed:", err));
  };

  // Persisting is now immediate (per-row) to Supabase. These remain as no-op
  // "Save" buttons for UX parity (and keep a localStorage cache as a fallback).
  const saveLocationRows = () => saveRows(LOCATION_STORAGE_KEY, locationRows);
  const savePartRows = () => saveRows(PART_ADDRESS_STORAGE_KEY, partRows);
  const saveCoverageRows = () => saveRows(COVERAGE_STORAGE_KEY, coverageRows);

  // Auto-save deduplicated locations to prevent duplicates from returning
  useEffect(() => {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(LOCATION_STORAGE_KEY) : null;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.rows) && parsed.rows.length > locationRows.length) {
          // Duplicates were removed, save the cleaned version
          saveRows(LOCATION_STORAGE_KEY, locationRows);
        }
      } catch {
        // Ignore parse errors
      }
    }
  }, [locationRows]);

  return (
    <main className="flex-1 bg-slate-950 py-6">
      <div className="mx-auto max-w-[1800px] px-6 text-white">
        {/* Back Button */}
        <Link 
          to="/m/$module" 
          params={{ module: "admin" }}
          className="inline-flex items-center gap-2 text-slate-300 hover:text-white mb-4 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Admin
        </Link>
        
        <div className="rounded-xl border border-white/15 bg-white/8 p-5 backdrop-blur-md">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{sub.title}</h1>
              <p className="mt-1 text-sm text-slate-300">{sub.description}</p>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2.5">
            {[
              { key: "locations", label: "Locations" },
              { key: "parts", label: "Part Addresses" },
              { key: "coverage", label: "Covered Zip Codes" },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key as typeof activeTab)}
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition-all ${activeTab === tab.key ? "border-blue-400/60 bg-blue-500/25 text-white" : "border-white/20 bg-slate-900/90 text-slate-300 hover:border-slate-200/30 hover:text-white"}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={openNewLocationModal}
            className="btn btn-primary whitespace-nowrap"
          >
            Add New Location
          </button>
        </div>

        {locationModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-sm">
            <div className="relative max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-white/15 bg-slate-950/95 shadow-2xl shadow-black/60">
              <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-white/10 bg-slate-950/95 px-5 py-4 backdrop-blur-md">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">{editingLocationId ? "Edit Location" : "Add New Location"}</h2>
                  <p className="mt-1 text-sm text-slate-300">Location ID {visibleLocationId}</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <button type="button" onClick={closeLocationModal} className="btn hover:bg-slate-800">Cancel</button>
                  <button type="button" onClick={() => { addLocationRow(); }} className="btn btn-primary">{editingLocationId ? "Update" : "Add Location"}</button>
                  {editingLocationId && (
                    <button type="button" onClick={deleteLocationRow} className="btn bg-red-600 hover:bg-red-700 border-red-500/50 text-white">Delete</button>
                  )}
                </div>
              </div>
              <div className="p-5">

            <div className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Location Name</span>
                  <input value={newLocationRow.location} onChange={(event) => setNewLocationRow((current) => ({ ...current, location: event.target.value }))} placeholder="Location Name" className="glass-input w-full text-[11px] px-2 py-1" />
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Office Location</span>
                  <select
                    value={newLocationRow.officeLocation || newLocationRow.location || ""}
                    onChange={(event) => setNewLocationRow((current) => applyOfficeLocationSelection(current, event.target.value, locationRows))}
                    className="glass-input w-full text-[11px] px-2 py-1"
                  >
                    <option value="">Select office location</option>
                    {OFFICE_LOCATION_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Delivery Recipient Name</span>
                  <input value={newLocationRow.deliveryRecipientName || ""} onChange={(event) => setNewLocationRow((current) => ({ ...current, deliveryRecipientName: event.target.value }))} placeholder="Delivery Recipient Name" className="glass-input w-full text-[11px] px-2 py-1" />
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Address 1</span>
                  <input value={newLocationRow.address1} onChange={(event) => setNewLocationRow((current) => ({ ...current, address1: event.target.value }))} placeholder="Address 1" className="glass-input w-full text-[11px] px-2 py-1" />
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Address 2</span>
                  <input value={newLocationRow.address2} onChange={(event) => setNewLocationRow((current) => ({ ...current, address2: event.target.value }))} placeholder="Address 2" className="glass-input w-full text-[11px] px-2 py-1" />
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">City</span>
                  <input value={newLocationRow.city} onChange={(event) => setNewLocationRow((current) => ({ ...current, city: event.target.value }))} placeholder="City" className="glass-input w-full text-[11px] px-2 py-1" />
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">State</span>
                  <select value={newLocationRow.state} onChange={(event) => setNewLocationRow((current) => ({ ...current, state: event.target.value }))} className="glass-input w-full text-[11px] px-2 py-1">
                    <option value="">Select state</option>
                    {STATE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Zip Code</span>
                  <input value={newLocationRow.zipCode} onChange={(event) => setNewLocationRow((current) => ({ ...current, zipCode: event.target.value }))} placeholder="Zip Code" className="glass-input w-full text-[11px] px-2 py-1" />
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Coordinates</span>
                  <input value={newLocationRow.coordinates || ""} onChange={(event) => setNewLocationRow((current) => ({ ...current, coordinates: event.target.value }))} placeholder="35.4680177, -82.5156063" className="glass-input w-full text-[11px] px-2 py-1" />
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Phone #</span>
                  <input value={newLocationRow.phoneNo} onChange={(event) => setNewLocationRow((current) => ({ ...current, phoneNo: event.target.value }))} placeholder="Phone #" className="glass-input w-full text-[11px] px-2 py-1" />
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Email</span>
                  <input value={newLocationRow.email} onChange={(event) => setNewLocationRow((current) => ({ ...current, email: event.target.value }))} placeholder="Email" className="glass-input w-full text-[11px] px-2 py-1" />
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Default Part Dist.</span>
                  <select value={newLocationRow.defaultPartDist} onChange={(event) => setNewLocationRow((current) => ({ ...current, defaultPartDist: event.target.value }))} className="glass-input w-full text-[11px] px-2 py-1">
                    <option value="">Select default part dist.</option>
                    {DEFAULT_PART_DIST_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Representative Technician</span>
                  <input value={newLocationRow.repTech} onChange={(event) => setNewLocationRow((current) => ({ ...current, repTech: event.target.value }))} placeholder="Representative Technician" className="glass-input w-full text-[11px] px-2 py-1" />
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Available Time Slot</span>
                  <select value={newLocationRow.availableTimeSlot || "ANY"} onChange={(event) => setNewLocationRow((current) => ({ ...current, availableTimeSlot: event.target.value }))} className="glass-input w-full text-[11px] px-2 py-1">
                    {AVAILABLE_TIME_SLOT_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Availability</div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {AVAILABLE_DAY_OPTIONS.map((day) => {
                      const checked = (newLocationRow.availableDays ?? []).includes(day);
                      return (
                        <label key={day} className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/60 px-2 py-1 text-sm text-slate-200">
                          <input type="checkbox" checked={checked} onChange={() => setNewLocationRow((current) => ({ ...current, availableDays: toggleListValue(current.availableDays, day) }))} />
                          <span>{day}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Flags</div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-200 sm:grid-cols-3">
                    {[
                      ["Check Processing", "checkProcessing"],
                      ["Credit Card Processing", "creditCardProcessing"],
                      ["Permission", "permission"],
                      ["SMS", "sms"],
                      ["Auto Triage", "autoTriage"],
                      ["Encompass Pickup W/H", "encompassPickupWH"],
                    ].map(([label, key]) => (
                      <label key={key} className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/60 px-2 py-1">
                        <input
                          type="checkbox"
                          checked={ynToCheckbox((newLocationRow as LocationRow & Record<string, unknown>)[key as keyof LocationRow] as "Y" | "N" | undefined)}
                          onChange={(event) => setNewLocationRow((current) => ({ ...current, [key]: checkboxToYN(event.target.checked) }))}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">OOW Default Charge</div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-slate-200">
                    <label className="space-y-1">
                      <span className="block text-xs text-slate-400">Labor Fee</span>
                      <input type="number" step="0.01" value={newLocationRow.laborFee || ""} onChange={(event) => setNewLocationRow((current) => ({ ...current, laborFee: event.target.value }))} placeholder="0" className="glass-input w-full text-[11px] px-2 py-1" />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-xs text-slate-400">Part Fee</span>
                      <input type="number" step="0.01" value={newLocationRow.partFee || ""} disabled={newLocationRow.oowPartActual} onChange={(event) => setNewLocationRow((current) => ({ ...current, partFee: event.target.value }))} placeholder="0" className="glass-input w-full text-[11px] px-2 py-1 disabled:opacity-50" />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-xs text-slate-400">Trip Fee</span>
                      <input type="number" step="0.01" value={newLocationRow.tripFee || ""} onChange={(event) => setNewLocationRow((current) => ({ ...current, tripFee: event.target.value }))} placeholder="0" className="glass-input w-full text-[11px] px-2 py-1" />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-xs text-slate-400">Others Fee</span>
                      <input type="number" step="0.01" value={newLocationRow.othersFee || ""} onChange={(event) => setNewLocationRow((current) => ({ ...current, othersFee: event.target.value }))} placeholder="0" className="glass-input w-full text-[11px] px-2 py-1" />
                    </label>
                  </div>
                  <label className="mt-3 flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/60 px-2 py-1 text-xs text-slate-200">
                    <input type="checkbox" checked={newLocationRow.oowPartActual === true} onChange={(event) => setNewLocationRow((current) => ({ ...current, oowPartActual: event.target.checked }))} />
                    <span>Actual Part Price will be applied</span>
                  </label>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Covered Technicians</div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    Ticking a technician here also sets <span className="text-slate-300">{newLocationRow.location || "this branch"}</span> as their Assigned Branch on save.
                  </div>
                  <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-white/10 bg-slate-950/60 p-3">
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {(() => {
                        // Merge the live roster with any technicians already
                        // ticked on this row but no longer in the roster (e.g.
                        // legacy names) so saved data stays visible.
                        const ticked = newLocationRow.coveredTechnicians ?? [];
                        const rosterNames = new Set(technicianRoster.map((t) => t.name));
                        const legacy = ticked.filter((name) => !rosterNames.has(name));
                        const merged: Array<{ id: string | null; name: string; assignedBranch: string | null }> = [
                          ...technicianRoster,
                          ...legacy.map((name) => ({ id: null, name, assignedBranch: null })),
                        ];
                        if (merged.length === 0) {
                          return (
                            <div className="col-span-full text-xs text-slate-500 italic">
                              No technicians found for this company. Add users with the TECHNICIAN role first.
                            </div>
                          );
                        }
                        return merged.map((tech) => {
                          const checked = ticked.includes(tech.name);
                          const isAssignedHere = tech.assignedBranch && newLocationRow.location && tech.assignedBranch === newLocationRow.location;
                          return (
                            <label key={tech.id || tech.name} className="flex items-start gap-2 rounded-md border border-white/10 bg-white/[0.02] px-2 py-1 text-xs text-slate-200">
                              <input type="checkbox" className="mt-0.5" checked={checked} onChange={() => setNewLocationRow((current) => ({ ...current, coveredTechnicians: toggleStringValue(current.coveredTechnicians, tech.name) }))} />
                              <span className="flex-1">
                                <span>{tech.name}</span>
                                {tech.assignedBranch ? (
                                  <span className={`block text-[10px] ${isAssignedHere ? "text-emerald-300" : "text-slate-500"}`}>
                                    {isAssignedHere ? "★ assigned here" : `currently: ${tech.assignedBranch}`}
                                  </span>
                                ) : null}
                              </span>
                            </label>
                          );
                        });
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "locations" && (
        <section className="mt-5 rounded-xl border border-white/15 bg-white/8 p-4 backdrop-blur-md">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-300">
              <span className="font-semibold text-white">{filteredLocations.length}</span> record{filteredLocations.length === 1 ? "" : "s"} found
            </div>
            <input
              value={locationSearch}
              onChange={(event) => setLocationSearch(event.target.value)}
              placeholder="Search locations..."
              className="glass-input w-full sm:w-64"
              aria-label="Search locations"
            />
          </div>
          <div className="overflow-x-auto rounded-lg border border-white/10 bg-slate-950/60">
            <table className="w-full text-[11px] leading-tight">
              <thead>
                <tr className="bg-slate-900/90 text-blue-200">
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">ID</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">Location</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">Address1</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">Address2</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">City</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">State</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">Zip</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">Office</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">Phone</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">Email</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">Part Dist.</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">Rep. Tech.</th>
                  <th className="px-1.5 py-1.5 text-center whitespace-nowrap">SMS</th>
                  <th className="px-1.5 py-1.5 text-center whitespace-nowrap">Email</th>
                  <th className="px-1.5 py-1.5 text-center whitespace-nowrap">Auto</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 text-slate-200">
                {filteredLocations.map((row, index) => (
                  <tr key={row.id} className={index % 2 === 0 ? "bg-white/[0.02]" : "bg-white/[0.04]"}>
                    <td className="px-1.5 py-1.5 align-middle whitespace-nowrap">{row.legacyId || row.id}</td>
                    <td className="px-1.5 py-1.5 align-middle whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => editLocationRow(row)}
                        className="text-left font-semibold text-blue-300 underline-offset-2 hover:underline focus:outline-none"
                        title="Open location details"
                      >
                        {row.location}
                      </button>
                    </td>
                    <td className="px-1.5 py-1.5 align-middle truncate max-w-[160px]" title={row.address1}>{row.address1}</td>
                    <td className="px-1.5 py-1.5 align-middle truncate max-w-[100px]" title={row.address2}>{row.address2}</td>
                    <td className="px-1.5 py-1.5 align-middle whitespace-nowrap">{row.city}</td>
                    <td className="px-1.5 py-1.5 align-middle whitespace-nowrap">{row.state}</td>
                    <td className="px-1.5 py-1.5 align-middle whitespace-nowrap">{row.zipCode}</td>
                    <td className="px-1.5 py-1.5 align-middle truncate max-w-[120px]" title={row.office}>{row.office}</td>
                    <td className="px-1.5 py-1.5 align-middle whitespace-nowrap">{row.phoneNo}</td>
                    <td className="px-1.5 py-1.5 align-middle truncate max-w-[160px]" title={row.email}>{row.email}</td>
                    <td className="px-1.5 py-1.5 align-middle truncate max-w-[120px]" title={row.defaultPartDist}>{row.defaultPartDist}</td>
                    <td className="px-1.5 py-1.5 align-middle truncate max-w-[120px]" title={row.repTech}>{row.repTech}</td>
                    <td className="px-1.5 py-1.5 align-middle text-center">{row.sms}</td>
                    <td className="px-1.5 py-1.5 align-middle text-center">{row.emailFlag}</td>
                    <td className="px-1.5 py-1.5 align-middle text-center">{row.autoTriage}</td>
                    <td className="px-1.5 py-1.5 align-middle whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => editLocationRow(row)}
                        className="rounded border border-white/15 bg-slate-800 px-2 py-1 text-[10px] font-semibold text-slate-200 hover:bg-slate-700 mr-1"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCoverageLocation(row.location);
                          setNewCoverageRow(buildEmptyCoverageRow(row.location));
                          setActiveTab("coverage");
                        }}
                        className="rounded border border-blue-400/40 bg-blue-600/20 px-2 py-1 text-[10px] font-semibold text-blue-200 hover:bg-blue-600/30"
                      >
                        Zip Codes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        )}

        {activeTab === "parts" && (
        <section className="mt-6 rounded-xl border border-white/15 bg-white/8 p-4 backdrop-blur-md">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Part Addresses</h2>
              <p className="mt-1 text-sm text-slate-300">*Note: If you want to ship your part to the address that is not in the location, register the addresses here.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={addPartRow} className="btn">Add</button>
              <button type="button" onClick={savePartRows} className="btn btn-primary">Save</button>
            </div>
          </div>

          <div className="mt-4 mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-300">
              <span className="font-semibold text-white">{filteredPartRows.length}</span> record{filteredPartRows.length === 1 ? "" : "s"} found
            </div>
            <input
              value={partSearch}
              onChange={(event) => setPartSearch(event.target.value)}
              placeholder="Search part addresses..."
              className="glass-input w-full sm:w-64"
              aria-label="Search part addresses"
            />
          </div>

          <div className="overflow-x-auto rounded-lg border border-white/10 bg-slate-950/60">
            <table className="w-full text-[11px] leading-tight">
              <thead>
                <tr className="bg-slate-900/90 text-blue-200">
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">ID</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">Name</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">Address1</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">Address2</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">City</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">State</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">Zip</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">Location</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 text-slate-200">
                <tr className="bg-blue-500/10">
                  <td className="px-1.5 py-1.5 align-middle">
                    <div className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[11px] text-slate-200">{nextPartAddressId}</div>
                  </td>
                  <td className="px-1.5 py-1.5 align-middle"><input value={newPartRow.name} onChange={(event) => setNewPartRow((current) => ({ ...current, name: event.target.value }))} title="Name" placeholder="Name" className="glass-input w-full text-[11px] px-1.5 py-1" /></td>
                  <td className="px-1.5 py-1.5 align-middle"><input value={newPartRow.address1} onChange={(event) => setNewPartRow((current) => ({ ...current, address1: event.target.value }))} title="Address1" placeholder="Address1" className="glass-input w-full text-[11px] px-1.5 py-1" /></td>
                  <td className="px-1.5 py-1.5 align-middle"><input value={newPartRow.address2} onChange={(event) => setNewPartRow((current) => ({ ...current, address2: event.target.value }))} title="Address2" placeholder="Address2" className="glass-input w-full text-[11px] px-1.5 py-1" /></td>
                  <td className="px-1.5 py-1.5 align-middle"><input value={newPartRow.city} onChange={(event) => setNewPartRow((current) => ({ ...current, city: event.target.value }))} title="City" placeholder="City" className="glass-input w-full text-[11px] px-1.5 py-1" /></td>
                  <td className="px-1.5 py-1.5 align-middle"><input value={newPartRow.state} onChange={(event) => setNewPartRow((current) => ({ ...current, state: event.target.value }))} title="State" placeholder="State" className="glass-input w-full text-[11px] px-1.5 py-1" /></td>
                  <td className="px-1.5 py-1.5 align-middle"><input value={newPartRow.zipCode} onChange={(event) => setNewPartRow((current) => ({ ...current, zipCode: event.target.value }))} title="Zip" placeholder="Zip" className="glass-input w-full text-[11px] px-1.5 py-1" /></td>
                  <td className="px-1.5 py-1.5 align-middle"><input value={newPartRow.location} onChange={(event) => setNewPartRow((current) => ({ ...current, location: event.target.value }))} title="Location" placeholder="Location" className="glass-input w-full text-[11px] px-1.5 py-1" /></td>
                  <td className="px-1.5 py-1.5 align-middle whitespace-nowrap">
                    <button type="button" onClick={addPartRow} className="rounded border border-blue-400/40 bg-blue-600/30 px-2 py-1 text-[10px] font-semibold text-blue-200 hover:bg-blue-600/50">Add</button>
                  </td>
                </tr>
                {filteredPartRows.map((row, index) => (
                  <tr key={row.id} className={index % 2 === 0 ? "bg-white/[0.02]" : "bg-white/[0.04]"}>
                    <td className="px-1.5 py-1.5 align-middle whitespace-nowrap">{row.id}</td>
                    <td className="px-1.5 py-1.5 align-middle truncate max-w-[140px]" title={row.name}>{row.name}</td>
                    <td className="px-1.5 py-1.5 align-middle truncate max-w-[180px]" title={row.address1}>{row.address1}</td>
                    <td className="px-1.5 py-1.5 align-middle truncate max-w-[120px]" title={row.address2}>{row.address2}</td>
                    <td className="px-1.5 py-1.5 align-middle whitespace-nowrap">{row.city}</td>
                    <td className="px-1.5 py-1.5 align-middle whitespace-nowrap">{row.state}</td>
                    <td className="px-1.5 py-1.5 align-middle whitespace-nowrap">{row.zipCode}</td>
                    <td className="px-1.5 py-1.5 align-middle whitespace-nowrap">{row.location}</td>
                    <td className="px-1.5 py-1.5 align-middle whitespace-nowrap">
                      <button type="button" onClick={() => removePartRow(row.id)} className="rounded border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-[10px] font-semibold text-rose-300 hover:bg-rose-500/20">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        )}

        {activeTab === "coverage" && (
        <section className="mt-6 rounded-xl border border-white/15 bg-white/8 p-4 backdrop-blur-md">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Covered Zip Codes</h2>
              <p className="mt-1 text-sm text-slate-300">Location: {selectedCoverageLocation || "Select a location"}</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-[0.9fr_1.2fr]">
            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Location</span>
                  <select
                    value={selectedCoverageLocation}
                    onChange={(event) => {
                      const location = event.target.value;
                      setSelectedCoverageLocation(location);
                      setNewCoverageRow((current) => ({ ...current, location }));
                      setNewLocationRow((current) => applyOfficeLocationSelection(current, location, locationRows));
                    }}
                    className="glass-input w-full text-[11px] px-2 py-1"
                  >
                    {coverageLocationOptions.map((location) => (
                      <option key={location} value={location}>
                        {location}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Zip Code</span>
                  <input value={newCoverageRow.zipCode} onChange={(event) => setNewCoverageRow((current) => ({ ...current, zipCode: event.target.value }))} placeholder="Zip Code" className="glass-input w-full text-[11px] px-2 py-1" />
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">City</span>
                  <input value={newCoverageRow.city} onChange={(event) => setNewCoverageRow((current) => ({ ...current, city: event.target.value }))} placeholder="City" className="glass-input w-full text-[11px] px-2 py-1" />
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Self-Schedule</span>
                  <input value={newCoverageRow.selfSchedule} onChange={(event) => setNewCoverageRow((current) => ({ ...current, selfSchedule: event.target.value }))} placeholder="Self-Schedule" className="glass-input w-full text-[11px] px-2 py-1" />
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">X days later</span>
                  <input value={newCoverageRow.daysLater} onChange={(event) => setNewCoverageRow((current) => ({ ...current, daysLater: event.target.value }))} placeholder="X days later" className="glass-input w-full text-[11px] px-2 py-1" />
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Tier Code (SP)</span>
                  <input value={newCoverageRow.tierCode} onChange={(event) => setNewCoverageRow((current) => ({ ...current, tierCode: event.target.value }))} placeholder="Tier Code (SP)" className="glass-input w-full text-[11px] px-2 py-1" />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={addCoverageRow} className="btn btn-primary">Add</button>
                <button type="button" onClick={saveCoverageRows} className="btn">Save</button>
                <label className="btn cursor-pointer">
                  Import CSV
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        const csv = String(reader.result || "");
                        const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
                        const imported = lines.map((line, index) => {
                          const [location, zipCode, city = "", selfSchedule = "", daysLater = "", tierCode = ""] = line.split(",").map((value) => value.trim());
                          return {
                            id: String(Date.now() + index),
                            location: location || selectedCoverageLocation,
                            zipCode,
                            city,
                            selfSchedule,
                            daysLater,
                            tierCode,
                          } as CoverageRow;
                        }).filter((row) => row.zipCode);
                        if (imported.length) {
                          // Persist the imported coverage to Supabase, then
                          // reflect the saved rows (with real ids) in the UI.
                          (async () => {
                            try {
                              const chunkSize = 500;
                              const savedAll: CoverageRow[] = [];
                              for (let i = 0; i < imported.length; i += chunkSize) {
                                const saved = await sbInsertCoverageBulk(imported.slice(i, i + chunkSize));
                                savedAll.push(...saved);
                              }
                              setCoverageRows((current) => [...current, ...savedAll]);
                            } catch (err) {
                              console.error("Coverage import failed:", err);
                              alert(`Coverage import failed: ${err instanceof Error ? err.message : "Unknown error"}`);
                            }
                          })();
                        }
                      };
                      reader.readAsText(file);
                    }}
                  />
                </label>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Coverage Map</div>
                  <h3 className="mt-2 text-xl font-semibold text-white">{selectedCoverageLocation || "No location selected"}</h3>
                </div>
                {/* Toggle whether each polygon's zip code is rendered as a
                    pill label at its centroid. Useful for screenshots and
                    cleaner views; on by default. The effect that builds the
                    map adds the marker to coverageOverlayRefs; flipping
                    this just calls setMap(null|map) on each one. */}
                <label className="inline-flex items-center gap-2 text-xs text-slate-300 select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showZipLabels}
                    onChange={(e) => setShowZipLabels(e.target.checked)}
                    className="accent-blue-500 h-4 w-4"
                  />
                  Show zip codes
                </label>
              </div>
              <div className="relative mt-3 min-h-[580px] overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-blue-500/10 via-slate-900 to-cyan-500/10">
                <div ref={coverageMapContainerRef} className="google-map-canvas" aria-label="Google coverage map" />
                {(!coverageMapReady || coverageMapLoading) && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/75 text-center backdrop-blur-sm">
                    <div className="relative flex h-14 w-14 items-center justify-center">
                      <span className="absolute inline-block h-14 w-14 animate-spin rounded-full border-4 border-white/10 border-t-blue-400" />
                      <span className="absolute inline-block h-8 w-8 animate-spin-fast animate-spin-reverse rounded-full border-4 border-white/10 border-t-cyan-400" />
                    </div>
                    <div className="text-sm font-medium text-slate-200">
                      {coverageMapReady ? `Loading ${selectedCoverageLocation} coverage…` : "Loading Google coverage map…"}
                    </div>
                    {coverageMapError ? <div className="max-w-sm text-xs text-rose-300">{coverageMapError}</div> : null}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-5 mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-300">
              <span className="font-semibold text-white">{filteredCoverageRows.length}</span> record{filteredCoverageRows.length === 1 ? "" : "s"} found
              <span className="ml-3 text-slate-500">*Format: Location + Zip Code (CSV file)</span>
            </div>
            <input
              value={coverageSearch}
              onChange={(event) => setCoverageSearch(event.target.value)}
              placeholder="Search zip codes..."
              className="glass-input w-full sm:w-64"
              aria-label="Search coverage zip codes"
            />
          </div>

          <div className="overflow-x-auto rounded-lg border border-white/10 bg-slate-950/60">
            <table className="w-full text-[11px] leading-tight">
              <thead>
                <tr className="bg-slate-900/90 text-blue-200">
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">Zip</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">City</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">Location</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">Self-Sched.</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">X days</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">Tier (SP)</th>
                  <th className="px-1.5 py-1.5 text-left whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 text-slate-200">
                <tr className="bg-blue-500/10">
                  <td className="px-1.5 py-1.5 align-middle"><input value={newCoverageRow.zipCode} onChange={(event) => setNewCoverageRow((current) => ({ ...current, zipCode: event.target.value }))} placeholder="Zip" className="glass-input w-full text-[11px] px-1.5 py-1" /></td>
                  <td className="px-1.5 py-1.5 align-middle"><input value={newCoverageRow.city} onChange={(event) => setNewCoverageRow((current) => ({ ...current, city: event.target.value }))} placeholder="City" className="glass-input w-full text-[11px] px-1.5 py-1" /></td>
                  <td className="px-1.5 py-1.5 align-middle"><input value={newCoverageRow.location || selectedCoverageLocation} onChange={(event) => setNewCoverageRow((current) => ({ ...current, location: event.target.value }))} placeholder="Location" className="glass-input w-full text-[11px] px-1.5 py-1" /></td>
                  <td className="px-1.5 py-1.5 align-middle"><input value={newCoverageRow.selfSchedule} onChange={(event) => setNewCoverageRow((current) => ({ ...current, selfSchedule: event.target.value }))} placeholder="Self-Sched." className="glass-input w-full text-[11px] px-1.5 py-1" /></td>
                  <td className="px-1.5 py-1.5 align-middle"><input value={newCoverageRow.daysLater} onChange={(event) => setNewCoverageRow((current) => ({ ...current, daysLater: event.target.value }))} placeholder="X days" className="glass-input w-full text-[11px] px-1.5 py-1" /></td>
                  <td className="px-1.5 py-1.5 align-middle"><input value={newCoverageRow.tierCode} onChange={(event) => setNewCoverageRow((current) => ({ ...current, tierCode: event.target.value }))} placeholder="Tier" className="glass-input w-full text-[11px] px-1.5 py-1" /></td>
                  <td className="px-1.5 py-1.5 align-middle whitespace-nowrap">
                    <button type="button" onClick={addCoverageRow} className="rounded border border-blue-400/40 bg-blue-600/30 px-2 py-1 text-[10px] font-semibold text-blue-200 hover:bg-blue-600/50">Add</button>
                  </td>
                </tr>
                {filteredCoverageRows.map((row, index) => (
                  <tr key={row.id} className={index % 2 === 0 ? "bg-white/[0.02]" : "bg-white/[0.04]"}>
                    <td className="px-1.5 py-1.5 align-middle whitespace-nowrap">{row.zipCode}</td>
                    <td className="px-1.5 py-1.5 align-middle truncate max-w-[140px]" title={row.city}>{row.city}</td>
                    <td className="px-1.5 py-1.5 align-middle whitespace-nowrap">{row.location}</td>
                    <td className="px-1.5 py-1.5 align-middle whitespace-nowrap">{row.selfSchedule}</td>
                    <td className="px-1.5 py-1.5 align-middle whitespace-nowrap">{row.daysLater}</td>
                    <td className="px-1.5 py-1.5 align-middle whitespace-nowrap">{row.tierCode}</td>
                    <td className="px-1.5 py-1.5 align-middle whitespace-nowrap">
                      <button type="button" onClick={() => removeCoverageRow(row.id)} className="rounded border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-[10px] font-semibold text-rose-300 hover:bg-rose-500/20">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        )}
      </div>
    </main>
  );
}
