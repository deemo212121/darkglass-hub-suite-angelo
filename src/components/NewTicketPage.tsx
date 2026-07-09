import { useMemo, useState, useEffect } from "react";
import { Link, useSearch, useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { type Ticket } from "@/lib/ticketData";
import { createTicket as createSupabaseTicket } from "@/lib/supabase/tickets";
import { lookupZip } from "@/lib/zipCoverage";
import {
  cityStateMatchesZip,
  lookupZipCityState,
  type ZipLookupResult,
} from "@/lib/zipLookup";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

const TICKET_COPY_KEY_PREFIX = "ahs:ticket-copy:";

const SOURCES = [
  "Call in",
  "Centricity",
  "Duplicate",
  "Facebook",
  "Fidelity Home Insurance",
  "Google Search",
  "Redo",
  "Website Sales",
];

const STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware",
  "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
  "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
  "Pennsylvania", "Puerto Rico", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas",
  "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
];

const PRODUCT_CATEGORIES = [
  "Air Conditioner", "Bed", "Coffee Machines", "Compactor", "Cooktop", "Dehumidifier", "Dishwasher",
  "Disposer", "Drawer", "Dresser", "Dryer", "Duct", "Electric Cooktop", "Electric Oven range",
  "Electrical System", "Evaporator", "Fan", "Food Center", "Furnace", "Heater", "Home Theather",
  "Hood", "Ice Maker", "Laundry", "LCD TV", "LED TV", "Matress", "Microwave", "Mobile", "Monitor",
  "OLED TV", "Oven", "PDP TV", "Plasma TV", "Projection TV", "Range", "Refrigerator", "Trash Compactor",
  "TV", "Vacuum Cleaner", "Vent", "Washer", "Washer Dryer", "Window", "Wine Cellar",
];

const WARRANTY_TYPES = [
  "Concession L", "Concession LP", "Concession P", "Ext Labor Wty", "Ext Part Wty", "Ext Wty",
  "In warranty", "Labor only Wty", "Out-of-warranty", "Part only Wty", "Special Part 5 year", "Unknown",
];

const DEFAULT_FORM = {
  ticketNo: "",
  originalTicketNo: "",
  isRedo: false,
  fakeTicket: false,
  source: "",
  customerName: "",
  primaryPhone: "",
  secondaryPhone: "",
  email1: "",
  address: "",
  address2: "",
  city: "",
  zipCode: "",
  state: "",
  addressNote: "",
  model: "",
  serialNo: "",
  modelVersion: "",
  brand: "",
  productCategory: "",
  purchaseDate: "",
  warrantyType: "",
  cxPreferredDate: "",
  callTakenDate: new Date().toISOString().slice(0, 10),
  problemDescription: "",
};

export function NewTicketPage({ mod, sub }: Props) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [status, setStatus] = useState("");
  const [location, setLocation] = useState("");
  // Live USPS-equivalent zip lookup state.
  // - zipLookup: most recent successful resolution for the current zip.
  // - zipLookupPending: a request is in flight (used to disable the
  //   apply-suggestion button so we don't race the response).
  // - zipLookupError: "not found" / network failure indicator.
  const [zipLookup, setZipLookup] = useState<ZipLookupResult | null>(null);
  const [zipLookupPending, setZipLookupPending] = useState(false);
  const [zipLookupError, setZipLookupError] = useState<string | null>(null);
  const navigate = useNavigate();
  const createdTicketStatus = "Acknowledged";
  
  // Get query parameters using router's useSearch
  let copyToken: string | null = null;
  try {
    const searchParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    copyToken = searchParams.get("copyToken");
  } catch (e) {
    console.error("Error reading query params:", e);
  }

  useEffect(() => {
    if (!copyToken) return;
    
    try {
      const storageKey = `${TICKET_COPY_KEY_PREFIX}${copyToken}`;
      const copiedData = localStorage.getItem(storageKey);
      console.log(`Looking for storage key: ${storageKey}`);
      console.log(`Found data:`, copiedData ? "yes" : "no");
      
      if (copiedData) {
        const payload = JSON.parse(copiedData);
        console.log(`Parsed payload:`, payload);
        
        // Map payload to form structure with RE- prefix
        const newForm = {
          ticketNo: `RE-${payload.ticketNo}`,
          originalTicketNo: payload.ticketNo,
          isRedo: true,
          fakeTicket: false,
          source: payload.source || "",
          customerName: payload.customerName || "",
          primaryPhone: payload.primaryPhone || "",
          secondaryPhone: payload.secondaryPhone || "",
          email1: payload.email || "",
          address: payload.address || "",
          address2: payload.address2 || "",
          city: payload.city || "",
          zipCode: payload.zip || "",
          state: payload.state || "",
          addressNote: payload.addressNote || "",
          model: payload.model || "",
          serialNo: payload.serialNo || "",
          modelVersion: payload.modelVersion || "",
          brand: payload.brand || "",
          productCategory: payload.productCategory || "",
          purchaseDate: payload.purchaseDate || "",
          warrantyType: payload.warrantyType || "",
          cxPreferredDate: payload.cxPreferredDate || "",
          callTakenDate: new Date().toISOString().slice(0, 10),
          problemDescription: payload.problemDescription || "",
        };
        setForm(newForm);
        localStorage.removeItem(storageKey);
      } else {
        console.log("No copied data found in localStorage");
      }
    } catch (error) {
      console.error("Failed to load copied ticket data:", error);
    }
  }, [copyToken]);

  const ticketNoPreview = useMemo(() => form.ticketNo.trim().toUpperCase() || "NEW-TICKET", [form.ticketNo]);

  const update = <K extends keyof typeof DEFAULT_FORM>(key: K, value: (typeof DEFAULT_FORM)[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleCreateTicket = async () => {
    // Validate required fields
    if (!form.ticketNo.trim()) {
      setStatus("Error: Ticket number is required");
      return;
    }
    if (!form.source) {
      setStatus("Error: Source is required");
      return;
    }
    if (!form.customerName.trim()) {
      setStatus("Error: Customer name is required");
      return;
    }
    if (!form.primaryPhone.trim()) {
      setStatus("Error: Primary phone is required");
      return;
    }
    if (!form.address.trim()) {
      setStatus("Error: Address is required");
      return;
    }
    if (!form.city.trim()) {
      setStatus("Error: City is required");
      return;
    }
    if (!form.zipCode.trim()) {
      setStatus("Error: Zip code is required");
      return;
    }
    if (!form.state) {
      setStatus("Error: State is required");
      return;
    }
    // Final zip ↔ city/state guard. We re-run the lookup at submit time
    // so we still block when the user typed everything fast and the
    // banner hadn't refreshed yet. If the live lookup is unreachable
    // (offline / API down), fall through — we don't want to block ticket
    // creation on a third-party service.
    try {
      const verify = await lookupZipCityState(form.zipCode);
      if (verify && !cityStateMatchesZip(verify, form.city, form.state)) {
        setStatus(
          `Error: ZIP ${verify.zip} is ${verify.primary.city}, ${verify.primary.state} — not ${form.city || "—"}, ${form.state || "—"}. Fix the city / state (or the ZIP) before saving.`,
        );
        return;
      }
    } catch {
      // ignore — network blip shouldn't block the save
    }
    if (!form.model.trim()) {
      setStatus("Error: Model is required");
      return;
    }
    if (!form.serialNo.trim()) {
      setStatus("Error: Serial number is required");
      return;
    }
    if (!form.brand.trim()) {
      setStatus("Error: Brand is required");
      return;
    }
    if (!form.productCategory) {
      setStatus("Error: Product category is required");
      return;
    }
    if (!form.warrantyType) {
      setStatus("Error: Warranty type is required");
      return;
    }
    if (!form.problemDescription.trim()) {
      setStatus("Error: Problem description is required");
      return;
    }

    // Create ticket object matching Ticket interface
    const newTicket: Ticket = {
      ticketNo: form.ticketNo.trim().toUpperCase(),
      warranty: form.warrantyType.includes("In warranty") ? "IW" : "OW",
      manufacturer: form.brand,
      ticketSource: form.source,
      customer: form.customerName,
      firstName: form.customerName.split(" ")[0] || "",
      lastName: form.customerName.split(" ").slice(1).join(" ") || "",
      phone: form.primaryPhone,
      secondPhone: form.secondaryPhone || "",
      email: form.email1 || "",
      address: form.address,
      address2: form.address2,
      city: form.city,
      zip: form.zipCode,
      state: form.state,
      addressNote: form.addressNote || "",
      location: location || "Unknown",
      model: form.model,
      serial: form.serialNo,
      modelVersion: form.modelVersion || "",
      productType: form.productCategory,
      purchaseDate: form.purchaseDate || "",
      diagnosed: form.problemDescription,
      internalNote: "",
      status: createdTicketStatus,
      schedule: form.cxPreferredDate ? new Date(form.cxPreferredDate).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" }) : "",
      technician: "",
      customerPref: form.cxPreferredDate ? "Yes" : "No",
      redo: form.isRedo ? "Yes" : "No",
      aging: 0,
      calls: 0,
      partOrder: "",
      created: new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" }),
      statusChangedAt: new Date().toISOString(),
      fakeTicket: form.fakeTicket,
      originalTicketNo: form.originalTicketNo || undefined,
      callReceivedDate: form.callTakenDate,
    };

    console.log("Creating new ticket with data:", newTicket);

    // Save to Supabase (company auto-scoped via RLS)
    (async () => {
      try {
        setStatus("Creating ticket...");
        await createSupabaseTicket(newTicket);
        setStatus(`✓ Ticket ${newTicket.ticketNo} created successfully!`);
        setTimeout(() => {
          navigate({ to: `/ticket/${newTicket.ticketNo}` });
        }, 1200);
      } catch (err: any) {
        console.error("Create ticket failed:", err);
        const msg = String(err?.message || "");
        if (msg.includes("duplicate") || msg.includes("unique")) {
          setStatus(`Error: Ticket number ${newTicket.ticketNo} already exists`);
        } else {
          setStatus(`Error creating ticket: ${msg || "Unknown error"}`);
        }
      }
    })();
  };

  return (
    <main className="max-w-[1400px] mx-auto px-6 py-6">
      <div className="flex items-center gap-3 mb-4">
        <Link to="/m/$module" params={{ module: mod.slug }} className="btn">
          <ChevronLeft className="h-4 w-4" /> Back to Tickets
        </Link>
        <div>
          <h1 className="text-2xl font-semibold leading-tight">{sub.title}</h1>
          <p className="text-sm text-muted-foreground">{sub.description}</p>
        </div>
      </div>

      <div className="ticket-form-container">
        <div className="ticket-form-header">
          <div>
            <p className="ticket-form-kicker">Create New Ticket</p>
            <h2>Create New Ticket</h2>
          </div>
          <div className="ticket-form-badge">{ticketNoPreview}</div>
        </div>

        <form className="ticket-form">
          <section className="ticket-form-section">
            <h3 className="ticket-form-section-title">Customer Information</h3>
            <div className="ticket-form-grid">
              <div className="form-group">
                <label className="form-label required" htmlFor="ticketNo">Ticket No</label>
                <input id="ticketNo" className="form-input" value={form.ticketNo} onChange={(event) => update("ticketNo", event.target.value)} required />
              </div>
              <div className="form-group form-group-inline">
                <div className="form-checkbox-group">
                  <input id="fakeTicket" type="checkbox" className="form-checkbox" checked={form.fakeTicket} onChange={(event) => update("fakeTicket", event.target.checked)} />
                  <label className="form-label" htmlFor="fakeTicket">Fake Ticket (not included statistically)</label>
                </div>
              </div>
            </div>

            <div className="ticket-form-grid">
              <div className="form-group">
                <label className="form-label required" htmlFor="source">Source</label>
                <select id="source" className="form-select" value={form.source} onChange={(event) => update("source", event.target.value)} required>
                  <option value="">Select Source</option>
                  {SOURCES.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label required" htmlFor="customerName">Name</label>
                <input id="customerName" className="form-input" value={form.customerName} onChange={(event) => update("customerName", event.target.value)} required />
              </div>
            </div>

            <div className="ticket-form-grid ticket-form-grid-3">
              <div className="form-group">
                <label className="form-label required" htmlFor="primaryPhone">Primary Phone</label>
                <input id="primaryPhone" className="form-input" type="tel" value={form.primaryPhone} onChange={(event) => update("primaryPhone", event.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="secondaryPhone">Secondary Phone</label>
                <input id="secondaryPhone" className="form-input" type="tel" value={form.secondaryPhone} onChange={(event) => update("secondaryPhone", event.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="email1">Email</label>
                <input id="email1" className="form-input" type="email" value={form.email1} onChange={(event) => update("email1", event.target.value)} />
              </div>
            </div>

            <div className="ticket-form-grid">
              <div className="form-group">
                <label className="form-label required" htmlFor="address">Address</label>
                <input id="address" className="form-input" value={form.address} onChange={(event) => update("address", event.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="address2">Address 2</label>
                <input id="address2" className="form-input" value={form.address2} onChange={(event) => update("address2", event.target.value)} />
              </div>
            </div>

            <div className="ticket-form-grid">
              <div className="form-group">
                <label className="form-label required" htmlFor="city">City</label>
                <input id="city" className="form-input" value={form.city} onChange={(event) => update("city", event.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label required" htmlFor="zipCode">Zip Code</label>
                <input
                  id="zipCode"
                  className="form-input"
                  value={form.zipCode}
                  onChange={(event) => {
                    const val = event.target.value.replace(/\D/g, "").slice(0, 5);
                    update("zipCode", val);
                    // Reset lookup state on every keystroke so the banner
                    // doesn't lag behind the input.
                    setZipLookup(null);
                    setZipLookupError(null);
                    if (val.length === 5) {
                      // Internal branch / coverage match (instant — local data).
                      const found = lookupZip(val);
                      if (found) setLocation(found.location);
                      // Live USPS-equivalent lookup so we can verify the
                      // typed city / state match this ZIP. Auto-fills any
                      // empty city / state field with the canonical value.
                      setZipLookupPending(true);
                      void lookupZipCityState(val).then((result) => {
                        setZipLookupPending(false);
                        if (!result) {
                          setZipLookupError("ZIP not found in the USPS lookup. Double-check the value.");
                          return;
                        }
                        setZipLookup(result);
                        setForm((prev) => ({
                          ...prev,
                          // Auto-fill empty fields. Don't overwrite values
                          // the user already typed — the banner below
                          // flags mismatches and offers a one-click fix.
                          city: prev.city.trim() ? prev.city : result.primary.city,
                          state: prev.state.trim() ? prev.state : result.primary.state,
                        }));
                      });
                    } else {
                      setZipLookupPending(false);
                    }
                  }}
                  inputMode="numeric"
                  pattern="\d{5}"
                  maxLength={5}
                  required
                />
                {/* Internal coverage match (branch / tier) */}
                {form.zipCode.length === 5 && (() => {
                  const z = lookupZip(form.zipCode);
                  return z ? (
                    <p className="text-xs text-green-400 mt-1">
                      ✓ {z.location} branch — {z.city}
                      {z.tierCode ? ` (${z.tierCode})` : ""}
                    </p>
                  ) : (
                    <p className="text-xs text-red-400 mt-1">
                      ⚠ Zip code not in coverage area
                    </p>
                  );
                })()}
                {/* USPS-equivalent validation status */}
                {form.zipCode.length === 5 && zipLookupPending && (
                  <p className="text-xs text-slate-400 mt-1">
                    Looking up city / state for {form.zipCode}…
                  </p>
                )}
                {zipLookupError && (
                  <p className="text-xs text-amber-300 mt-1">⚠ {zipLookupError}</p>
                )}
                {zipLookup && !cityStateMatchesZip(zipLookup, form.city, form.state) && (
                  <div className="mt-1 rounded border border-amber-400/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200">
                    <div>
                      ⚠ ZIP <span className="font-mono">{zipLookup.zip}</span> is in{" "}
                      <span className="font-semibold">
                        {zipLookup.primary.city}, {zipLookup.primary.state}
                      </span>
                      {zipLookup.places.length > 1 && (
                        <span className="text-amber-300/80">
                          {" "}
                          (also: {zipLookup.places.slice(1).map((p) => p.city).join(", ")})
                        </span>
                      )}
                      , not {form.city || "—"}, {form.state || "—"}.
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          city: zipLookup.primary.city,
                          state: zipLookup.primary.state,
                        }))
                      }
                      className="mt-1 text-xs font-semibold text-amber-100 underline underline-offset-2 hover:text-white"
                    >
                      Use suggested values
                    </button>
                  </div>
                )}
              </div>
              <div className="form-group">
                <label className="form-label required" htmlFor="state">State</label>
                <select id="state" className="form-select" value={form.state} onChange={(event) => update("state", event.target.value)} required>
                  <option value="">Select State</option>
                  {STATES.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </div>
            </div>

            <div className="ticket-form-grid">
              <div className="form-group full-width">
                <label className="form-label" htmlFor="addressNote">Address Note</label>
                <textarea id="addressNote" className="form-textarea" rows={3} value={form.addressNote} onChange={(event) => update("addressNote", event.target.value)} />
              </div>
            </div>
          </section>

          <section className="ticket-form-section">
            <h3 className="ticket-form-section-title">Product Information</h3>
            <div className="ticket-form-grid">
              <div className="form-group">
                <label className="form-label required" htmlFor="model">Model</label>
                <input id="model" className="form-input" value={form.model} onChange={(event) => update("model", event.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label required" htmlFor="serialNo">Serial</label>
                <input id="serialNo" className="form-input" value={form.serialNo} onChange={(event) => update("serialNo", event.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="modelVersion">Model Version</label>
                <input id="modelVersion" className="form-input" value={form.modelVersion} onChange={(event) => update("modelVersion", event.target.value)} />
              </div>
            </div>

            <div className="ticket-form-grid">
              <div className="form-group">
                <label className="form-label required" htmlFor="brand">Brand</label>
                <input id="brand" className="form-input" value={form.brand} onChange={(event) => update("brand", event.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label required" htmlFor="productCategory">Product Category</label>
                <select id="productCategory" className="form-select" value={form.productCategory} onChange={(event) => update("productCategory", event.target.value)} required>
                  <option value="">Select Category</option>
                  {PRODUCT_CATEGORIES.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </div>
            </div>

            <div className="ticket-form-grid">
              <div className="form-group">
                <label className="form-label" htmlFor="purchaseDate">Purchase Date</label>
                <input id="purchaseDate" className="form-input" type="date" value={form.purchaseDate} onChange={(event) => update("purchaseDate", event.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label required" htmlFor="warrantyType">Warranty Type</label>
                <select id="warrantyType" className="form-select" value={form.warrantyType} onChange={(event) => update("warrantyType", event.target.value)} required>
                  <option value="">Select Warranty Type</option>
                  {WARRANTY_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </div>
            </div>

            <div className="ticket-form-grid ticket-form-grid-3">
              <div className="form-group">
                <label className="form-label" htmlFor="cxPreferredDate">Cx Preferred Date</label>
                <input id="cxPreferredDate" className="form-input" type="date" value={form.cxPreferredDate} onChange={(event) => update("cxPreferredDate", event.target.value)} />
              </div>
            </div>
          </section>

          <section className="ticket-form-section">
            <h3 className="ticket-form-section-title">Call (Service) Information</h3>
            <div className="ticket-form-grid">
              <div className="form-group">
                <label className="form-label required" htmlFor="callTakenDate">Call Received Date</label>
                <input id="callTakenDate" className="form-input" type="date" value={form.callTakenDate} onChange={(event) => update("callTakenDate", event.target.value)} required />
              </div>
            </div>
            <div className="ticket-form-grid">
              <div className="form-group full-width">
                <label className="form-label required" htmlFor="problemDescription">Problem Description</label>
                <textarea id="problemDescription" className="form-textarea" rows={5} value={form.problemDescription} onChange={(event) => update("problemDescription", event.target.value)} required />
              </div>
            </div>
          </section>

          <div className="ticket-form-actions">
            <p className="ticket-form-status">{status}</p>
            <button type="button" className="btn btn-secondary" onClick={() => {
              setForm(DEFAULT_FORM);
              setStatus("");
              setLocation("");
            }}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCreateTicket}
            >
              Create Ticket
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}