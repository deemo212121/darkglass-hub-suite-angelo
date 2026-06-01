import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

interface Props { mod: ModuleDef; sub: SubModuleDef; }

type TicketCopyPayload = {
  ticketNo: string;
  source: string;
  customerName: string;
  primaryPhone: string;
  secondaryPhone: string;
  email1: string;
  address: string;
  city: string;
  zipCode: string;
  state: string;
  addressNote: string;
  model: string;
  serialNo: string;
  modelVersion: string;
  brand: string;
  productCategory: string;
  purchaseDate: string;
  warrantyType: string;
  cxPreferredDate: string;
  callTakenDate: string;
  problemDescription: string;
};

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
  source: "",
  customerName: "",
  primaryPhone: "",
  secondaryPhone: "",
  email1: "",
  address: "",
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
  const createdTicketStatus = "Acknowledged";

  const ticketNoPreview = useMemo(() => form.ticketNo.trim().toUpperCase() || "NEW-TICKET", [form.ticketNo]);

  const update = <K extends keyof typeof DEFAULT_FORM>(key: K, value: (typeof DEFAULT_FORM)[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const searchParams = new URLSearchParams(window.location.search);
    const copyToken = searchParams.get("copyToken");
    if (!copyToken) return;

    const storageKey = `${TICKET_COPY_KEY_PREFIX}${copyToken}`;
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return;

    try {
      const payload = JSON.parse(raw) as TicketCopyPayload;
      setForm((current) => ({
        ...current,
        ...payload,
      }));
      setStatus(`Loaded from copied ticket ${payload.ticketNo}.`);
    } catch {
      setStatus("Unable to load copied ticket data.");
    } finally {
      window.localStorage.removeItem(storageKey);
    }
  }, []);

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
            <div className="ticket-form-grid ticket-form-grid-3">
              <div className="form-group">
                <label className="form-label required" htmlFor="ticketNo">Ticket No</label>
                <input id="ticketNo" className="form-input" value={form.ticketNo} onChange={(event) => update("ticketNo", event.target.value)} required />
              </div>
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
                <label className="form-label required" htmlFor="primaryPhone">Primary Number</label>
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
              <div className="form-group full-width">
                <label className="form-label required" htmlFor="address">Address</label>
                <input id="address" className="form-input" value={form.address} onChange={(event) => update("address", event.target.value)} required />
              </div>
            </div>

            <div className="ticket-form-grid">
              <div className="form-group">
                <label className="form-label required" htmlFor="city">City</label>
                <input id="city" className="form-input" value={form.city} onChange={(event) => update("city", event.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label required" htmlFor="zipCode">Zip Code</label>
                <input id="zipCode" className="form-input" value={form.zipCode} onChange={(event) => update("zipCode", event.target.value)} required />
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
            <button type="button" className="btn btn-secondary" onClick={() => setForm(DEFAULT_FORM)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setStatus(`Ticket ${ticketNoPreview} created with status ${createdTicketStatus}.`)}
            >
              Create Ticket
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}