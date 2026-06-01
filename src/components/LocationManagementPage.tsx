import { useEffect, useMemo, useRef, useState } from "react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import ashevilleCoverageCsv from "../../grid_coverage/asheville.csv?raw";
import memphisCoverageCsv from "../../grid_coverage/memphis.csv?raw";
import { normalizeLocationName } from "@/lib/locations";

const GOOGLE_MAPS_API_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? "AIzaSyBnTWvcdQZsXsohbrHLBiA3zsMGhVZYPbc";

type LocationRow = {
  id: string;
  location: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zipCode: string;
  office: string;
  phoneNo: string;
  email: string;
  defaultPartDist: string;
  repTech: string;
  sms: "Y" | "N";
  emailFlag: "Y" | "N";
  autoTriage: "Y" | "N";
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

function normalizeLocationKey(value: string) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildEmptyLocationRow(): LocationRow {
  return {
    id: "",
    location: "",
    address1: "",
    address2: "",
    city: "",
    state: "",
    zipCode: "",
    office: "",
    phoneNo: "",
    email: "",
    defaultPartDist: "",
    repTech: "",
    sms: "N",
    emailFlag: "N",
    autoTriage: "N",
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
  ...parseCoverageCsv(ashevilleCoverageCsv),
  ...parseCoverageCsv(memphisCoverageCsv).map((row, index) => ({
    ...row,
    id: String(parseInt(row.id, 10) + 10000 + index),
  })),
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
  const [locationRows, setLocationRows] = useState<LocationRow[]>(() => loadRows(LOCATION_STORAGE_KEY, DEFAULT_LOCATION_ROWS));
  const [partRows, setPartRows] = useState<PartAddressRow[]>(() => loadRows(PART_ADDRESS_STORAGE_KEY, DEFAULT_PART_ADDRESS_ROWS));
  const [coverageRows, setCoverageRows] = useState<CoverageRow[]>(() => loadRows(COVERAGE_STORAGE_KEY, DEFAULT_COVERAGE_ROWS));
  const [locationSearch, setLocationSearch] = useState("");
  const [partSearch, setPartSearch] = useState("");
  const [coverageSearch, setCoverageSearch] = useState("");
  const [newLocationRow, setNewLocationRow] = useState<LocationRow>(() => buildEmptyLocationRow());
  const [newPartRow, setNewPartRow] = useState<PartAddressRow>({ id: "", name: "", address1: "", address2: "", city: "", state: "", zipCode: "", location: "" });
  const [newCoverageRow, setNewCoverageRow] = useState<CoverageRow>(() => buildEmptyCoverageRow());
  const [selectedCoverageLocation, setSelectedCoverageLocation] = useState(() => DEFAULT_COVERAGE_ROWS[0]?.location ?? locationRows[0]?.location ?? "Birmingham");
  const [coverageMapReady, setCoverageMapReady] = useState(false);
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
    return coverageRows.filter((row) => row.location === selectedCoverageLocation && matchesQuery([row.id, row.zipCode, row.city, row.location, row.selfSchedule, row.daysLater, row.tierCode], query));
  }, [coverageRows, coverageSearch, selectedCoverageLocation]);

  useEffect(() => {
    if (activeTab !== "coverage") return;
    const matchedLocation = resolveCoverageLocation(locationSearch, locationRows, coverageRows);
    if (matchedLocation && matchedLocation !== selectedCoverageLocation) {
      setSelectedCoverageLocation(matchedLocation);
      setNewCoverageRow((current) => ({ ...current, location: matchedLocation }));
    }
  }, [activeTab, coverageRows, locationRows, locationSearch, selectedCoverageLocation]);

  const selectedLocationCoverage = useMemo(
    () => coverageRows.filter((row) => row.location === selectedCoverageLocation),
    [coverageRows, selectedCoverageLocation],
  );

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

      // Always re-create the map if the container div has changed (tab remount)
      if (
        !coverageMapRef.current ||
        coverageMapRef.current.getDiv() !== coverageMapContainerRef.current
      ) {
        coverageMapRef.current = new maps.Map(coverageMapContainerRef.current, {
          center: { lat: 37.0902, lng: -95.7129 },
          zoom: 4,
          mapTypeId: maps.MapTypeId.ROADMAP,
          disableDefaultUI: false,
          zoomControl: true,
          mapTypeControl: true,
          gestureHandling: "greedy",
        });
      }

      setCoverageMapReady(true);
      setCoverageMapError(null);
    };

    const existingScript = document.querySelector<HTMLScriptElement>('script[data-google-maps="location-coverage"]');
    if ((window as Window & { google?: any }).google?.maps) {
      initializeMap();
    } else if (existingScript) {
      existingScript.addEventListener("load", initializeMap, { once: true });
      existingScript.addEventListener(
        "error",
        () => {
          if (!cancelled) setCoverageMapError("Google Maps failed to load.");
        },
        { once: true },
      );
    } else {
      const script = document.createElement("script");
      script.dataset.googleMaps = "location-coverage";
      script.async = true;
      script.defer = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&v=3.52`;
      script.onload = initializeMap;
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
      const point = await geocodeZip(zipCode);
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

    Promise.all(
      uniqueZipCodes.map(async (zipCode) => {
        const [point, geojson] = await Promise.all([fetchZipPoint(zipCode), fetchZipGeoJson(zipCode)]);
        return { zipCode, point, geojson };
      }),
    ).then((results) => {
        if (cancelled || !coverageMapRef.current) return;

        const validPoints = results
          .map((result) => result.point)
          .filter((point): point is MapZipGeometry => Boolean(point));

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

        validPoints.forEach((point) => {
          bounds.extend(point.center);
        });

        results.forEach((result) => {
          if (!result.geojson) return;
          mapData.addGeoJson(result.geojson);
        });

        if (!bounds.isEmpty()) {
          coverageMapRef.current.fitBounds(bounds, { padding: 40 });
        } else {
          coverageMapRef.current.setCenter({ lat: 37.0902, lng: -95.7129 });
          coverageMapRef.current.setZoom(4);
          setCoverageMapError("No geocodable zip codes found for this location.");
        }
      });

    return () => {
      cancelled = true;
      coverageOverlayRefs.current.forEach((overlay) => overlay.setMap(null));
      coverageOverlayRefs.current = [];
      mapData.forEach((feature: any) => mapData.remove(feature));
    };
  }, [activeTab, coverageMapReady, selectedLocationCoverage, coverageGeocodeCacheRef, coverageMapRef, coverageOverlayRefs, coverageZipGeoJsonCacheRef]);

  const addLocationRow = () => {
    if (!newLocationRow.location.trim()) return;
    const nextRow = { ...newLocationRow, id: nextLocationId };
    setLocationRows((current) => [nextRow, ...current]);
    setNewLocationRow(buildEmptyLocationRow());
  };

  const addPartRow = () => {
    if (!newPartRow.name.trim()) return;
    setPartRows((current) => [...current, { ...newPartRow, id: nextPartAddressId }]);
    setNewPartRow({ id: "", name: "", address1: "", address2: "", city: "", state: "", zipCode: "", location: "" });
  };

  const addCoverageRow = () => {
    if (!newCoverageRow.zipCode.trim()) return;
    setCoverageRows((current) => [...current, { ...newCoverageRow, id: nextCoverageId, location: selectedCoverageLocation || newCoverageRow.location }]);
    setNewCoverageRow(buildEmptyCoverageRow(selectedCoverageLocation));
  };

  const removeLocationRow = (rowId: string) => setLocationRows((current) => current.filter((row) => row.id !== rowId));
  const removePartRow = (rowId: string) => setPartRows((current) => current.filter((row) => row.id !== rowId));
  const removeCoverageRow = (rowId: string) => setCoverageRows((current) => current.filter((row) => row.id !== rowId));

  const saveLocationRows = () => saveRows(LOCATION_STORAGE_KEY, locationRows);
  const savePartRows = () => saveRows(PART_ADDRESS_STORAGE_KEY, partRows);
  const saveCoverageRows = () => saveRows(COVERAGE_STORAGE_KEY, coverageRows);

  return (
    <main className="flex-1 bg-slate-950 py-6">
      <div className="mx-auto max-w-[1800px] px-6 text-white">
        <div className="rounded-xl border border-white/15 bg-white/8 p-5 backdrop-blur-md">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{sub.title}</h1>
              <p className="mt-1 text-sm text-slate-300">{sub.description}</p>
            </div>
            <div className="text-right text-sm text-slate-400">
              <div className="text-2xl font-bold text-white">31 records found</div>
              <div>search in result</div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-4">
            <div className="w-full max-w-md">
              <label className="block text-xs font-semibold uppercase tracking-[0.04em] text-slate-400">Search</label>
              <input
                value={locationSearch}
                onChange={(event) => setLocationSearch(event.target.value)}
                placeholder="Search locations..."
                className="glass-input mt-2 w-full"
              />
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <button type="button" onClick={saveLocationRows} className="btn btn-primary">Save</button>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2.5">
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

        {activeTab === "locations" && (
        <section className="mt-5 rounded-xl border border-white/15 bg-white/8 p-4 backdrop-blur-md">
          <div className="mt-5 overflow-x-auto rounded-lg border border-white/10 bg-slate-950/60">
            <table className="min-w-[1600px] w-full text-[11px] leading-tight">
              <thead>
                <tr className="bg-slate-900/90 text-blue-200">
                  <th className="px-2 py-2 text-left whitespace-nowrap">ID</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Location</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Address1</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Address2</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">City</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">State</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Zip Code</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Office</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Phone No</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Email</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Default Part Dist.</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Rep. Tech.</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">SMS</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Email</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Auto Triage</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 text-slate-200">
                <tr className="bg-blue-500/10">
                  <td className="px-4 py-3 align-middle">
                    <div className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200">{nextLocationId}</div>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <input value={newLocationRow.location} onChange={(event) => setNewLocationRow((current) => ({ ...current, location: event.target.value }))} title="Location" placeholder="Location" className="glass-input w-full min-w-[110px] text-[11px] px-2 py-1" />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <input value={newLocationRow.address1} onChange={(event) => setNewLocationRow((current) => ({ ...current, address1: event.target.value }))} title="Address1" placeholder="Address1" className="glass-input w-full min-w-[180px] text-[11px] px-2 py-1" />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <input value={newLocationRow.address2} onChange={(event) => setNewLocationRow((current) => ({ ...current, address2: event.target.value }))} title="Address2" placeholder="Address2" className="glass-input w-full min-w-[120px] text-[11px] px-2 py-1" />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <input value={newLocationRow.city} onChange={(event) => setNewLocationRow((current) => ({ ...current, city: event.target.value }))} title="City" placeholder="City" className="glass-input w-full min-w-[120px] text-[11px] px-2 py-1" />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <input value={newLocationRow.state} onChange={(event) => setNewLocationRow((current) => ({ ...current, state: event.target.value }))} title="State" placeholder="State" className="glass-input w-full min-w-[80px] text-[11px] px-2 py-1" />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <input value={newLocationRow.zipCode} onChange={(event) => setNewLocationRow((current) => ({ ...current, zipCode: event.target.value }))} title="Zip Code" placeholder="Zip Code" className="glass-input w-full min-w-[95px] text-[11px] px-2 py-1" />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <input value={newLocationRow.office} onChange={(event) => setNewLocationRow((current) => ({ ...current, office: event.target.value }))} title="Office" placeholder="Office" className="glass-input w-full min-w-[110px] text-[11px] px-2 py-1" />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <input value={newLocationRow.phoneNo} onChange={(event) => setNewLocationRow((current) => ({ ...current, phoneNo: event.target.value }))} title="Phone No" placeholder="Phone No" className="glass-input w-full min-w-[120px] text-[11px] px-2 py-1" />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <input value={newLocationRow.email} onChange={(event) => setNewLocationRow((current) => ({ ...current, email: event.target.value }))} title="Email" placeholder="Email" className="glass-input w-full min-w-[220px] text-[11px] px-2 py-1" />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <input value={newLocationRow.defaultPartDist} onChange={(event) => setNewLocationRow((current) => ({ ...current, defaultPartDist: event.target.value }))} title="Default Part Dist." placeholder="Default Part Dist." className="glass-input w-full min-w-[180px] text-[11px] px-2 py-1" />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <input value={newLocationRow.repTech} onChange={(event) => setNewLocationRow((current) => ({ ...current, repTech: event.target.value }))} title="Rep. Tech." placeholder="Rep. Tech." className="glass-input w-full min-w-[150px] text-[11px] px-2 py-1" />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <select value={newLocationRow.sms} onChange={(event) => setNewLocationRow((current) => ({ ...current, sms: event.target.value as LocationRow["sms"] }))} title="SMS" aria-label="SMS" className="glass-input w-full min-w-[70px] text-[11px] px-2 py-1">
                      {YES_NO_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <select value={newLocationRow.emailFlag} onChange={(event) => setNewLocationRow((current) => ({ ...current, emailFlag: event.target.value as LocationRow["emailFlag"] }))} title="Email" aria-label="Email flag" className="glass-input w-full min-w-[70px] text-[11px] px-2 py-1">
                      {YES_NO_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <select value={newLocationRow.autoTriage} onChange={(event) => setNewLocationRow((current) => ({ ...current, autoTriage: event.target.value as LocationRow["autoTriage"] }))} title="Auto Triage" aria-label="Auto Triage" className="glass-input w-full min-w-[80px] text-[11px] px-2 py-1">
                      {YES_NO_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <button type="button" onClick={addLocationRow} className="btn btn-primary">Add</button>
                  </td>
                </tr>
                {filteredLocations.map((row, index) => (
                  <tr key={row.id} className={index % 2 === 0 ? "bg-white/[0.02]" : "bg-white/[0.04]"}>
                    <td className="px-4 py-3 align-middle">
                      <span className="block px-2 py-1">{row.id}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="block px-2 py-1">{row.location}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="block px-2 py-1">{row.address1}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="block px-2 py-1">{row.address2}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="block px-2 py-1">{row.city}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="block px-2 py-1">{row.state}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="block px-2 py-1">{row.zipCode}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="block px-2 py-1">{row.office}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="block px-2 py-1">{row.phoneNo}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="block px-2 py-1">{row.email}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="block px-2 py-1">{row.defaultPartDist}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="block px-2 py-1">{row.repTech}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="block px-2 py-1">{row.sms}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="block px-2 py-1">{row.emailFlag}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="block px-2 py-1">{row.autoTriage}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCoverageLocation(row.location);
                          setNewCoverageRow(buildEmptyCoverageRow(row.location));
                          setActiveTab("coverage");
                        }}
                        className="btn"
                      >
                        View Covered Zip Code
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-xs text-slate-400">{filteredLocations.length} records found</div>
        </section>
        )}

        {activeTab === "parts" && (
        <section className="mt-6 rounded-xl border border-white/15 bg-white/8 p-4 backdrop-blur-md">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Part Addresses</h2>
              <p className="mt-1 text-sm text-slate-300">*Note: If you want to ship your part to the address that is not in the location, register the addresses here.</p>
            </div>
            <div className="text-right text-sm text-slate-400">
              <div className="text-2xl font-bold text-white">12 records found</div>
              <div>search in result</div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-4">
            <div className="w-full max-w-md">
              <label className="block text-xs font-semibold uppercase tracking-[0.04em] text-slate-400">Search</label>
              <input
                value={partSearch}
                onChange={(event) => setPartSearch(event.target.value)}
                placeholder="Search part addresses..."
                className="glass-input mt-2 w-full"
              />
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <button type="button" onClick={addPartRow} className="btn">Add</button>
              <button type="button" onClick={savePartRows} className="btn btn-primary">Save</button>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto rounded-lg border border-white/10 bg-slate-950/60">
            <table className="min-w-[1200px] w-full text-[11px] leading-tight">
              <thead>
                <tr className="bg-slate-900/90 text-blue-200">
                  <th className="px-2 py-2 text-left whitespace-nowrap">ID</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Name</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Address1</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Address2</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">City</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">State</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Zip Code</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Location</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 text-slate-200">
                <tr className="bg-blue-500/10">
                  <td className="px-4 py-3 align-middle">
                    <div className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200">{nextPartAddressId}</div>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <input value={newPartRow.name} onChange={(event) => setNewPartRow((current) => ({ ...current, name: event.target.value }))} title="Name" placeholder="Name" className="glass-input w-full min-w-[110px] text-[11px] px-2 py-1" />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <input value={newPartRow.address1} onChange={(event) => setNewPartRow((current) => ({ ...current, address1: event.target.value }))} title="Address1" placeholder="Address1" className="glass-input w-full min-w-[180px] text-[11px] px-2 py-1" />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <input value={newPartRow.address2} onChange={(event) => setNewPartRow((current) => ({ ...current, address2: event.target.value }))} title="Address2" placeholder="Address2" className="glass-input w-full min-w-[120px] text-[11px] px-2 py-1" />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <input value={newPartRow.city} onChange={(event) => setNewPartRow((current) => ({ ...current, city: event.target.value }))} title="City" placeholder="City" className="glass-input w-full min-w-[120px] text-[11px] px-2 py-1" />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <input value={newPartRow.state} onChange={(event) => setNewPartRow((current) => ({ ...current, state: event.target.value }))} title="State" placeholder="State" className="glass-input w-full min-w-[120px] text-[11px] px-2 py-1" />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <input value={newPartRow.zipCode} onChange={(event) => setNewPartRow((current) => ({ ...current, zipCode: event.target.value }))} title="Zip Code" placeholder="Zip Code" className="glass-input w-full min-w-[95px] text-[11px] px-2 py-1" />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <input value={newPartRow.location} onChange={(event) => setNewPartRow((current) => ({ ...current, location: event.target.value }))} title="Location" placeholder="Location" className="glass-input w-full min-w-[110px] text-[11px] px-2 py-1" />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <button type="button" onClick={addPartRow} className="btn btn-primary">Add</button>
                  </td>
                </tr>
                {filteredPartRows.map((row, index) => (
                  <tr key={row.id} className={index % 2 === 0 ? "bg-white/[0.02]" : "bg-white/[0.04]"}>
                    <td className="px-4 py-3 align-middle">
                      <span className="block px-2 py-1">{row.id}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="block px-2 py-1">{row.name}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="block px-2 py-1">{row.address1}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="block px-2 py-1">{row.address2}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="block px-2 py-1">{row.city}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="block px-2 py-1">{row.state}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="block px-2 py-1">{row.zipCode}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className="block px-2 py-1">{row.location}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <button type="button" onClick={() => removePartRow(row.id)} className="btn">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-xs text-slate-400">{filteredPartRows.length} records found</div>
        </section>
        )}

        {activeTab === "coverage" && (
        <section className="mt-6 rounded-xl border border-white/15 bg-white/8 p-4 backdrop-blur-md">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Covered Zip Codes</h2>
              <p className="mt-1 text-sm text-slate-300">Location: {selectedCoverageLocation || "Select a location"}</p>
            </div>
            <div className="text-right text-sm text-slate-400">
              <div className="text-2xl font-bold text-white">{filteredCoverageRows.length} records found</div>
              <div>search in result</div>
            </div>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.08em] text-slate-400">Location</span>
                  <input value={newCoverageRow.location || selectedCoverageLocation} onChange={(event) => setNewCoverageRow((current) => ({ ...current, location: event.target.value }))} className="glass-input w-full text-[11px] px-2 py-1" />
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
                          setCoverageRows((current) => [...current, ...imported]);
                        }
                      };
                      reader.readAsText(file);
                    }}
                  />
                </label>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Coverage Map</div>
              <h3 className="mt-2 text-xl font-semibold text-white">{selectedCoverageLocation || "No location selected"}</h3>
              <div className="relative mt-3 min-h-[520px] overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-blue-500/10 via-slate-900 to-cyan-500/10">
                <div ref={coverageMapContainerRef} className="google-map-canvas" aria-label="Google coverage map" />
                {!coverageMapReady && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/70 text-center">
                    <div className="text-sm text-slate-300">Loading Google coverage map...</div>
                    {coverageMapError ? <div className="max-w-sm text-xs text-rose-300">{coverageMapError}</div> : null}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-4">
            <div className="w-full max-w-md">
              <label className="block text-xs font-semibold uppercase tracking-[0.04em] text-slate-400">Search</label>
              <input
                value={coverageSearch}
                onChange={(event) => setCoverageSearch(event.target.value)}
                placeholder="Search coverage zip codes..."
                className="glass-input mt-2 w-full"
              />
            </div>
            <div className="ml-auto text-sm text-slate-400">
              *Format: Location + Zip Code (CSV file)
            </div>
          </div>

          <div className="mt-5 overflow-x-auto rounded-lg border border-white/10 bg-slate-950/60">
            <table className="min-w-[1300px] w-full text-[11px] leading-tight">
              <thead>
                <tr className="bg-slate-900/90 text-blue-200">
                  <th className="px-2 py-2 text-left whitespace-nowrap">Zip Code</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">City</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Location</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Self-Schedule</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">X days later</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Tier Code (SP)</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 text-slate-200">
                <tr className="bg-blue-500/10">
                  <td className="px-4 py-3 align-middle">
                    <input value={newCoverageRow.zipCode} onChange={(event) => setNewCoverageRow((current) => ({ ...current, zipCode: event.target.value }))} placeholder="Zip Code" className="glass-input w-full min-w-[95px] text-[11px] px-2 py-1" />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <input value={newCoverageRow.city} onChange={(event) => setNewCoverageRow((current) => ({ ...current, city: event.target.value }))} placeholder="City" className="glass-input w-full min-w-[120px] text-[11px] px-2 py-1" />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <input value={newCoverageRow.location || selectedCoverageLocation} onChange={(event) => setNewCoverageRow((current) => ({ ...current, location: event.target.value }))} placeholder="Location" className="glass-input w-full min-w-[110px] text-[11px] px-2 py-1" />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <input value={newCoverageRow.selfSchedule} onChange={(event) => setNewCoverageRow((current) => ({ ...current, selfSchedule: event.target.value }))} placeholder="Self-Schedule" className="glass-input w-full min-w-[140px] text-[11px] px-2 py-1" />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <input value={newCoverageRow.daysLater} onChange={(event) => setNewCoverageRow((current) => ({ ...current, daysLater: event.target.value }))} placeholder="X days later" className="glass-input w-full min-w-[110px] text-[11px] px-2 py-1" />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <input value={newCoverageRow.tierCode} onChange={(event) => setNewCoverageRow((current) => ({ ...current, tierCode: event.target.value }))} placeholder="Tier Code (SP)" className="glass-input w-full min-w-[150px] text-[11px] px-2 py-1" />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <button type="button" onClick={addCoverageRow} className="btn btn-primary">Add</button>
                  </td>
                </tr>
                {filteredCoverageRows.map((row, index) => (
                  <tr key={row.id} className={index % 2 === 0 ? "bg-white/[0.02]" : "bg-white/[0.04]"}>
                    <td className="px-4 py-3 align-middle"><span className="block px-2 py-1">{row.zipCode}</span></td>
                    <td className="px-4 py-3 align-middle"><span className="block px-2 py-1">{row.city}</span></td>
                    <td className="px-4 py-3 align-middle"><span className="block px-2 py-1">{row.location}</span></td>
                    <td className="px-4 py-3 align-middle"><span className="block px-2 py-1">{row.selfSchedule}</span></td>
                    <td className="px-4 py-3 align-middle"><span className="block px-2 py-1">{row.daysLater}</span></td>
                    <td className="px-4 py-3 align-middle"><span className="block px-2 py-1">{row.tierCode}</span></td>
                    <td className="px-4 py-3 align-middle">
                      <button type="button" onClick={() => removeCoverageRow(row.id)} className="btn">Delete</button>
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
