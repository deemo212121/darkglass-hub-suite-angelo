import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ALL_TECHNICIANS } from "@/lib/locations";

interface TicketData {
  ticketNo: string;
  account: string;
  warranty: string;
  product: string;
  tat: string;
  status: string;
  schedule: string;
  contact: string;
  location: string;
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  homePhone: string;
  cellPhone: string;
  email: string;
  brand: string;
  model: string;
  serialNo: string;
  productCategory: string;
  purchaseDate: string;
  warrantyType: string;
  claimCompany: string;
  accountNo: string;
  callNo: string;
  callType: string;
  callStatus: string;
  postingDate: string;
  problemDescription: string;
  scheduleDate: string;
  schedulePeriod: string;
  technician: string;
  customerNotes: Array<{ date: string; notes: string; by: string }>;
  servicerNotes: Array<{ notes: string; by: string }>;
}

interface CompensationRow {
  id: string;
  item: string;
  beneficiary: string;
  amount: string;
  rate: string;
  activityDate: string;
  requiresClaimOrCxPayment: string;
  comment: string;
  createdBy: string;
  lastModifiedBy: string;
}

const DEFAULT_TICKET: TicketData = {
  ticketNo: "017151274136",
  account: "SQUARE TRADE",
  warranty: "IW",
  product: "Dryer",
  tat: "0d",
  status: "CSR-Assigned to ASC",
  schedule: "N/A",
  contact: "Sched.",
  location: "Lake Charles",
  firstName: "ROBERT",
  lastName: "CHANCE",
  address: "119 COUNTY RD. 4156",
  city: "DEWEYVILLE",
  state: "Texas",
  zip: "77614",
  homePhone: "409-221-5089",
  cellPhone: "409-221-5089",
  email: "robert0278@yahoo.com",
  brand: "GENERAL ELECTRIC",
  model: "GTX33EASKWW",
  serialNo: "",
  productCategory: "Dryer",
  purchaseDate: "04/11/2025",
  warrantyType: "In warranty",
  claimCompany: "SQUARE TRADE",
  accountNo: "GSL00002",
  callNo: "017151274136",
  callType: "In warranty",
  callStatus: "ACCEPTED / ACCEPTED",
  postingDate: "2026-05-29",
  problemDescription: "THE START BUTTON IS NOT WORKING IT GETS STUCK WHEN IT S PUSHED DOWN.",
  scheduleDate: "2026-06-05",
  schedulePeriod: "12:00 - 17:00 AFTERNOON",
  technician: "",
  customerNotes: [
    {
      date: "05/29/2026 04:36:35",
      notes: "Allstate call created: model & issue details. Repair date: 2026-06-05. Time Slot: 12-17. Parts have been sent. Tracking numbers will be updated once available.",
      by: "SQTRADE1",
    },
  ],
  servicerNotes: [],
};

const TICKET_DATA: Record<string, TicketData> = {
  "017151274136": DEFAULT_TICKET,
  "039873174136": {
    ...DEFAULT_TICKET,
    ticketNo: "039873174136",
    account: "SQUARE TRADE",
    product: "Dryer",
    status: "CL-Claimed",
    schedule: "2026-05-28 09:30 AM",
    firstName: "ROBERT",
    lastName: "CHANCE",
    city: "DEWEYVILLE",
    problemDescription: "CLAIMED TICKET FOR THE SAME CUSTOMER EMAIL.",
    callNo: "039873174136",
    customerNotes: [
      {
        date: "05/20/2026 09:12:02",
        notes: "Related claim created and linked to the same customer profile.",
        by: "SQTRADE1",
      },
    ],
  },
  "026000671769DF1": {
    ...DEFAULT_TICKET,
    ticketNo: "026000671769DF1",
    account: "GSL00002",
    warranty: "IW",
    product: "Washer",
    tat: "3d",
    status: "OP-Waiting for Part",
    schedule: "05/18/26",
    contact: "Y",
    location: "Atlanta",
    firstName: "ROSE",
    lastName: "PHILLIPS",
    city: "ELLENWOOD",
    zip: "30294",
    homePhone: "404.640.7141",
    cellPhone: "404.640.7141",
    email: "rose.phillips@example.com",
    brand: "IH",
    model: "DV45K7600EW",
    productCategory: "Washer",
    warrantyType: "In warranty",
    claimCompany: "GSL00002",
    accountNo: "GSL00002",
    callNo: "026000671769DF1",
    callType: "In warranty",
    callStatus: "ACCEPTED / ACCEPTED",
    postingDate: "2026-05-15",
    scheduleDate: "2026-05-18",
    schedulePeriod: "08:00 - 12:00 MORNING",
    technician: "Nathan Napora",
    problemDescription: "WASHER IS NOT SPINNING.",
  },
  "1007208750-10": {
    ...DEFAULT_TICKET,
    ticketNo: "1007208750-10",
    account: "GSL00002",
    warranty: "IW",
    product: "Dryer",
    tat: "1d",
    status: "CSR-Assigned to ASC",
    schedule: "05/19/26",
    contact: "N",
    location: "Atlanta",
    firstName: "CHARLES",
    lastName: "MCDONALD",
    city: "GREENSBORO",
    state: "GA",
    homePhone: "404.680.4022",
    cellPhone: "404.680.4022",
    email: "charles.mcdonald@example.com",
    brand: "IH",
    model: "FRUF2020AW",
    productCategory: "Dryer",
    warrantyType: "In warranty",
    claimCompany: "GSL00002",
    accountNo: "GSL00002",
    callNo: "1007208750-10",
    callType: "SMS",
    callStatus: "CSR-Assigned to ASC",
    postingDate: "2026-05-17",
    scheduleDate: "2026-05-19",
    schedulePeriod: "N/A",
    technician: "",
    problemDescription: "DRYER ISSUE FROM THE TICKET LIST. DETAILS SHOULD MATCH THE LIST ENTRY.",
    customerNotes: [
      {
        date: "05/17/2026 10:05:44",
        notes: "Imported from the ticket list record for Charles Mcdonald.",
        by: "SYSTEM",
      },
    ],
  },
  "SA-3458831": {
    ...DEFAULT_TICKET,
    ticketNo: "SA-3458831",
    account: "GSL00002",
    warranty: "IW",
    product: "Dryer",
    tat: "0d",
    status: "CSR-Assigned to ASC",
    schedule: "05/21/26",
    contact: "N",
    location: "Atlanta",
    firstName: "NEAL",
    lastName: "MARKET",
    city: "GREENSBORO",
    state: "GA",
    homePhone: "706.817.2900",
    cellPhone: "706.817.2900",
    email: "neal.market@example.com",
    brand: "IH",
    model: "GNE27JYMFFS",
    productCategory: "Dryer",
    warrantyType: "In warranty",
    claimCompany: "GSL00002",
    accountNo: "GSL00002",
    callNo: "SA-3458831",
    callType: "SMS",
    callStatus: "CSR-Assigned to ASC",
    postingDate: "2026-05-18",
    scheduleDate: "2026-05-21",
    schedulePeriod: "N/A",
    technician: "",
    problemDescription: "TICKET FROM THE LIST VIEW: NEEDS FULL DETAILS TO OPEN HERE.",
    customerNotes: [
      {
        date: "05/18/2026 08:14:11",
        notes: "Ticket entered from list view and opened from the ticket number field.",
        by: "SYSTEM",
      },
    ],
  },
  "26000679102DF": {
    ...DEFAULT_TICKET,
    ticketNo: "26000679102DF",
    account: "GSL00002",
    warranty: "IW",
    product: "Cooktop",
    tat: "1d",
    status: "CSR-Assigned to ASC",
    schedule: "05/19/26",
    contact: "N",
    location: "Atlanta",
    firstName: "BRIAN",
    lastName: "ROWE",
    city: "SHADY DALE",
    state: "GA",
    zip: "30071",
    homePhone: "706.366.1043",
    cellPhone: "706.366.1043",
    email: "brian.rowe@example.com",
    brand: "IH",
    model: "FCRE3083AS",
    productCategory: "Cooktop",
    warrantyType: "In warranty",
    claimCompany: "GSL00002",
    accountNo: "GSL00002",
    callNo: "26000679102DF",
    callType: "SMS",
    callStatus: "CSR-Assigned to ASC",
    postingDate: "2026-05-17",
    scheduleDate: "2026-05-19",
    schedulePeriod: "N/A",
    technician: "",
    problemDescription: "COOKTOP IS NOT HEATING CORRECTLY.",
  },
};

export const Route = createFileRoute("/ticket/$ticketNo")({
  ssr: false,
  head: () => ({
    meta: [{
      title: `Ticket Details — Admin Hub Solutions`,
    }],
  }),
  component: TicketDetailsPage,
});

function TicketDetailsPage() {
  const { ticketNo } = Route.useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"general" | "tracking" | "compensation" | "billing">("general");
  const [newServicerNote, setNewServicerNote] = useState("");
  const [selectedTicket, setSelectedTicket] = useState(ticketNo);
  const currentEditor = "Current User";
  const [compensationRows, setCompensationRows] = useState<CompensationRow[]>([
    {
      id: "comp-1",
      item: "Extra Labor",
      beneficiary: "Anna Seo",
      amount: "1",
      rate: "",
      activityDate: "05/29/2026",
      requiresClaimOrCxPayment: "",
      comment: "",
      createdBy: currentEditor,
      lastModifiedBy: currentEditor,
    },
  ]);

  const handleTicketChange = (newTicketNo: string) => {
    if (newTicketNo.trim()) {
      setSelectedTicket(newTicketNo);
      navigate({ to: `/ticket/${newTicketNo}` });
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedTicket(e.target.value);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleTicketChange(selectedTicket);
    }
  };

  // Sync selected ticket with URL parameter
  useEffect(() => {
    setSelectedTicket(ticketNo);
  }, [ticketNo]);

  const ticket = TICKET_DATA[ticketNo];

  const addServicerNote = () => {
    if (newServicerNote.trim()) {
      ticket.servicerNotes.push({
        notes: newServicerNote,
        by: "Current User",
      });
      setNewServicerNote("");
    }
  };

  const addCompensationRow = () => {
    setCompensationRows((rows) => [
      ...rows,
      {
        id: `comp-${Date.now()}`,
        item: "",
        beneficiary: "",
        amount: "",
        rate: "",
        activityDate: "05/29/2026",
        requiresClaimOrCxPayment: "",
        comment: "",
        createdBy: currentEditor,
        lastModifiedBy: currentEditor,
      },
    ]);
  };

  const updateCompensationRow = (rowId: string, field: keyof Omit<CompensationRow, "id" | "createdBy" | "lastModifiedBy">, value: string) => {
    setCompensationRows((rows) =>
      rows.map((row) =>
        row.id === rowId
          ? {
              ...row,
              [field]: value,
              lastModifiedBy: currentEditor,
            }
          : row,
      ),
    );
  };

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1 bg-slate-950 py-6">
        <div className="max-w-6xl mx-auto px-6">
          <div className="bg-white/8 border border-white/15 rounded-xl p-5 text-white backdrop-blur-md">
            <div className="mb-4 flex flex-wrap items-center gap-4">
              <label htmlFor="ticket-selector" className="text-slate-400 font-semibold">Select Ticket:</label>
              <input
                id="ticket-selector"
                type="text"
                value={selectedTicket}
                onChange={handleInputChange}
                onKeyPress={handleKeyPress}
                placeholder="Enter ticket number... (Press Enter)"
                className="bg-slate-900 border border-white/20 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 placeholder-slate-500"
              />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">Ticket #{ticketNo}</h1>
              {ticket ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-white/10 bg-slate-900/90 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.04em] text-slate-400">Account</div>
                    <div className="text-sm font-semibold text-white">{ticket.account}</div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-slate-900/90 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.04em] text-slate-400">Warranty</div>
                    <div className="text-sm font-semibold text-white">{ticket.warranty}</div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-slate-900/90 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.04em] text-slate-400">Status</div>
                    <div className="text-sm font-semibold text-blue-300">{ticket.status}</div>
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                  No ticket data is available for this number yet.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-6xl mx-auto px-6 mt-3">
          <div className="flex flex-wrap gap-2.5">
            {["general", "tracking", "compensation", "billing"].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition-all ${
                  activeTab === tab
                    ? "border-blue-400/60 bg-blue-500/25 text-white"
                    : "border-white/20 bg-slate-900/90 text-slate-300 hover:border-slate-200/30 hover:text-white"
                }`}
              >
                {tab === "tracking" ? "Service Tracking" : tab.charAt(0).toUpperCase() + tab.slice(1).replace(/([A-Z])/g, " $1")}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="max-w-6xl mx-auto px-6 py-6">
        {!ticket ? (
          <div className="rounded-lg border border-white/10 bg-slate-900/50 p-6 text-slate-300">
            <p className="text-lg font-semibold text-white">Ticket not found</p>
            <p className="mt-2 text-sm text-slate-400">
              The ticket number {ticketNo} does not have a matching record in the current sample data.
            </p>
          </div>
        ) : activeTab === "general" && (
          <div className="space-y-8">
            {/* Quick Info Grid */}
            <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-6">
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-slate-400 font-semibold">Product</div>
                  <div className="text-white">{ticket.product}</div>
                </div>
                <div>
                  <div className="text-slate-400 font-semibold">TAT</div>
                  <div className="text-white">{ticket.tat}</div>
                </div>
                <div>
                  <div className="text-slate-400 font-semibold">Schedule</div>
                  <div className="text-white">{ticket.schedule}</div>
                </div>
                <div>
                  <div className="text-slate-400 font-semibold">Contact</div>
                  <div className="text-white">{ticket.contact}</div>
                </div>
              </div>
            </div>

            {/* General Information */}
            <div>
              <h3 className="text-lg font-semibold text-blue-400 mb-4">General Information</h3>

              {/* Customer Information */}
              <div className="space-y-4 mb-8">
                <h4 className="font-semibold text-slate-300">Customer Information</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <label className="text-slate-500 font-semibold">Location</label>
                    <div className="text-white mt-1">{ticket.location}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Tier Code</label>
                    <div className="text-white mt-1">N/A</div>
                  </div>
                  <div className="col-span-2">
                    <label className="text-slate-500 font-semibold">First/Last Name</label>
                    <div className="text-white mt-1">{ticket.firstName} {ticket.lastName}</div>
                  </div>
                  <div className="col-span-2">
                    <label className="text-slate-500 font-semibold">Address</label>
                    <div className="text-white mt-1">{ticket.address}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">City</label>
                    <div className="text-white mt-1">{ticket.city}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">State/Zip</label>
                    <div className="text-white mt-1">{ticket.state} {ticket.zip}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Home Phone</label>
                    <div className="text-white mt-1">{ticket.homePhone}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Cell Phone</label>
                    <div className="text-white mt-1">{ticket.cellPhone}</div>
                  </div>
                  <div className="col-span-2">
                    <label className="text-slate-500 font-semibold">Email</label>
                    <div className="text-white mt-1">{ticket.email}</div>
                  </div>
                </div>
              </div>

              {/* Product Information */}
              <div className="space-y-4 mb-8">
                <h4 className="font-semibold text-slate-300">Product Information</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <label className="text-slate-500 font-semibold">Brand</label>
                    <div className="text-white mt-1">{ticket.brand}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Model Code</label>
                    <div className="text-white mt-1">{ticket.model}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Serial No</label>
                    <div className="text-white mt-1">{ticket.serialNo || "—"}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Product Category</label>
                    <div className="text-white mt-1">{ticket.productCategory}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Purchase Date</label>
                    <div className="text-white mt-1">{ticket.purchaseDate}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Warranty Type</label>
                    <div className="text-white mt-1">{ticket.warrantyType}</div>
                  </div>
                  <div className="col-span-2">
                    <label className="text-slate-500 font-semibold">Claim Company</label>
                    <div className="text-white mt-1">{ticket.claimCompany}</div>
                  </div>
                </div>
              </div>

              {/* Call Service Information */}
              <div className="space-y-4 mb-8">
                <h4 className="font-semibold text-slate-300">Call Service Information</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <label className="text-slate-500 font-semibold">Account No</label>
                    <div className="text-white mt-1">{ticket.accountNo}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Call No</label>
                    <div className="text-white mt-1">{ticket.callNo}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Call Type</label>
                    <div className="text-white mt-1">{ticket.callType}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Call Status</label>
                    <div className="text-blue-300 mt-1 font-semibold">{ticket.callStatus}</div>
                  </div>
                  <div className="col-span-2">
                    <label className="text-slate-500 font-semibold">Posting Date</label>
                    <div className="text-white mt-1">{ticket.postingDate}</div>
                  </div>
                </div>
              </div>

              {/* Schedule Information */}
              <div className="space-y-4 mb-8">
                <h4 className="font-semibold text-slate-300">Schedule Information</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <label className="text-slate-500 font-semibold">Schedule Date</label>
                    <div className="text-white mt-1">{ticket.scheduleDate}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Schedule Period</label>
                    <div className="text-white mt-1">{ticket.schedulePeriod}</div>
                  </div>
                  <div>
                    <label className="text-slate-500 font-semibold">Technician</label>
                    <div className="text-white mt-1">{ticket.technician || "Not assigned"}</div>
                  </div>
                </div>
              </div>

              {/* Problem Description */}
              <div className="space-y-4 mb-8">
                <h4 className="font-semibold text-slate-300">Problem Description</h4>
                <div className="bg-slate-900/50 border border-white/10 rounded p-4 text-sm text-slate-300">
                  {ticket.problemDescription}
                </div>
              </div>

              {/* Customer Notes */}
              <div className="space-y-4 mb-8">
                <h4 className="font-semibold text-slate-300">Customer Notes</h4>
                <div className="space-y-3">
                  {ticket.customerNotes.map((note, idx) => (
                    <div key={idx} className="bg-slate-900/50 border border-white/10 rounded p-4 text-sm">
                      <div className="flex justify-between items-start mb-2">
                        <div className="text-slate-400">{note.date}</div>
                        <div className="text-blue-400">By: {note.by}</div>
                      </div>
                      <p className="text-slate-300">{note.notes}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Servicer Notes */}
              <div className="space-y-4 pb-12">
                <h4 className="font-semibold text-slate-300">Servicer Notes</h4>
                <div className="space-y-3 mb-4">
                  {ticket.servicerNotes.map((note, idx) => (
                    <div key={idx} className="bg-slate-900/50 border border-blue-500/30 rounded p-4 text-sm">
                      <div className="text-blue-400 text-xs mb-1">By: {note.by}</div>
                      <p className="text-slate-300">{note.notes}</p>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <textarea
                    value={newServicerNote}
                    onChange={(e) => setNewServicerNote(e.target.value)}
                    placeholder="Add a new comment..."
                    className="flex-1 bg-slate-900 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    rows={3}
                  />
                  <button
                    onClick={addServicerNote}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded text-sm transition"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "tracking" && (
          <div className="space-y-8">
            {/* Related Tickets */}
            <div>
              <h4 className="font-semibold text-slate-300 mb-4">Related Tickets</h4>
              <div className="bg-blue-900/20 border border-blue-500/30 rounded p-3 mb-3 text-sm text-slate-400">
                1 distinct record found
              </div>
              <div className="overflow-x-auto border border-white/10 rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-blue-900/50 border-b border-blue-500/30">
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Ticket No</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Matched</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Src/Acct</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Cx Name</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Zip</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Phone</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Type</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Schedule</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Status</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Brands</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Model</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Tech Name</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-4 py-3 font-mono text-blue-400">039873174136</td>
                      <td className="px-4 py-3 text-slate-300">Same Email</td>
                      <td className="px-4 py-3 text-slate-300">SQUARE TRADE</td>
                      <td className="px-4 py-3 text-slate-300">Robert Chance</td>
                      <td className="px-4 py-3 text-slate-300">77614</td>
                      <td className="px-4 py-3 text-slate-300">409.221.5089</td>
                      <td className="px-4 py-3 text-slate-300">IH</td>
                      <td className="px-4 py-3 text-slate-300">2026-05-28 09:30 AM</td>
                      <td className="px-4 py-3 text-slate-300">CL-Claimed</td>
                      <td className="px-4 py-3 text-slate-300">GENERAL ELECTRIC</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-300">GTX33EASK1WW</td>
                      <td className="px-4 py-3 text-slate-300">Danny Thornton</td>
                      <td className="px-4 py-3 text-slate-300">05/20/26</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Attachments */}
            <div>
              <h4 className="font-semibold text-slate-300 mb-4">Attachments</h4>
              <div className="bg-slate-900/50 border border-white/10 rounded p-4 space-y-4">
                <div className="text-sm text-slate-400">No file chosen</div>
                <button className="text-blue-400 hover:text-blue-300 text-sm font-semibold">+ Add</button>
              </div>
            </div>

            {/* Visit Log */}
            <div>
              <h4 className="font-semibold text-slate-300 mb-4">Visit Log</h4>
              <div className="space-y-4 text-sm">
                <div>
                  <label className="text-slate-500 font-semibold">Phone</label>
                  <div className="text-white mt-1">409-221-5089</div>
                </div>
                <div>
                  <label className="text-slate-500 font-semibold">Chat</label>
                  <button className="text-blue-400 hover:text-blue-300 font-semibold">Open Chat</button>
                </div>
                <div>
                  <label className="text-slate-500 font-semibold">Redo Ticket #</label>
                  <div className="text-white mt-1">NONE</div>
                </div>
              </div>
            </div>

            {/* Visit Details Table */}
            <div>
              <h4 className="font-semibold text-slate-300 mb-4">Visit Details</h4>
              <div className="overflow-x-auto border border-white/10 rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-blue-900/50 border-b border-blue-500/30">
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">ID</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Schedule Date</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Technician*</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Symptom (Cx)</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Diagnosis</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Repair Type</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Status*</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-4 py-3 text-slate-300">V1</td>
                      <td className="px-4 py-3 text-slate-300">05/28/2026</td>
                      <td className="px-4 py-3 text-slate-300">Danny Thornton</td>
                      <td className="px-4 py-3 text-slate-300">THE START BUTTON IS NOT WORKING</td>
                      <td className="px-4 py-3 text-slate-300">Faulty control board</td>
                      <td className="px-4 py-3 text-slate-300">Board Replacement</td>
                      <td className="px-4 py-3 text-blue-300 font-semibold">Completed</td>
                      <td className="px-4 py-3">
                        <button className="text-blue-400 hover:text-blue-300 text-sm">View</button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Part Transaction */}
            <div>
              <h4 className="font-semibold text-slate-300 mb-4">Part Transaction</h4>
              <div className="space-y-4 mb-4">
                <div>
                  <label className="text-slate-500 font-semibold">Model Code</label>
                  <div className="text-white mt-1">GTX33EASKWW</div>
                </div>
              </div>
              <div className="bg-blue-900/20 border border-blue-500/30 rounded p-3 mb-3 text-sm text-slate-400">
                0 distinct record found
              </div>
              <div className="overflow-x-auto border border-white/10 rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-blue-900/50 border-b border-blue-500/30">
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">ID</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Part No*</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Part Desc</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">PO No</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Qty*</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Status*</th>
                      <th className="px-4 py-3 text-left font-semibold text-blue-300">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-white/5 hover:bg-white/5">
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-400">No parts recorded</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Comments */}
            <div>
              <h4 className="font-semibold text-slate-300 mb-4">Comments</h4>
              <div className="space-y-3 mb-4">
                <div className="bg-slate-900/50 border border-white/10 rounded p-4 text-sm">
                  <div className="text-slate-400 mb-2">No comments yet</div>
                </div>
              </div>
              <div className="flex gap-2">
                <textarea
                  placeholder="Add a comment..."
                  className="flex-1 bg-slate-900 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  rows={3}
                />
                <button className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded text-sm transition">
                  Add
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "compensation" && (
          <div className="space-y-6">
            <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <label className="block text-slate-500 font-semibold mb-2">Default Date:</label>
                  <div className="text-white bg-slate-950/70 border border-white/10 rounded px-3 py-2">05/29/2026</div>
                </div>
                <div>
                  <label className="block text-slate-500 font-semibold mb-2">Schedule Date</label>
                  <div className="text-white bg-slate-950/70 border border-white/10 rounded px-3 py-2">Today</div>
                </div>
                <div className="flex items-end">
                  <button
                    onClick={addCompensationRow}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded text-sm transition"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto border border-white/10 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-blue-900/50 border-b border-blue-500/30">
                    <th className="px-4 py-3 text-left font-semibold text-blue-300">Compensation Item</th>
                    <th className="px-4 py-3 text-left font-semibold text-blue-300">Beneficiary</th>
                    <th className="px-4 py-3 text-left font-semibold text-blue-300">Amount</th>
                    <th className="px-4 py-3 text-left font-semibold text-blue-300">Rate</th>
                    <th className="px-4 py-3 text-left font-semibold text-blue-300">Activity Date</th>
                    <th className="px-4 py-3 text-left font-semibold text-blue-300">Requires Approved Claim / Requires Cx Payment</th>
                    <th className="px-4 py-3 text-left font-semibold text-blue-300">Comment</th>
                    <th className="px-4 py-3 text-left font-semibold text-blue-300">Created by</th>
                    <th className="px-4 py-3 text-left font-semibold text-blue-300">Last Modified by</th>
                    <th className="px-4 py-3 text-left font-semibold text-blue-300">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {compensationRows.map((row) => (
                    <tr key={row.id} className="border-b border-white/5 align-top hover:bg-white/5">
                      <td className="px-4 py-3">
                        <input
                          value={row.item}
                          onChange={(e) => updateCompensationRow(row.id, "item", e.target.value)}
                          className="w-full bg-slate-900 border border-white/10 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                          placeholder="Compensation item"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={row.beneficiary}
                          onChange={(e) => updateCompensationRow(row.id, "beneficiary", e.target.value)}
                          title="Select technician"
                          className="w-full bg-slate-900 border border-white/10 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                        >
                          <option value="">Select technician</option>
                          {ALL_TECHNICIANS.map((technician) => (
                            <option key={technician} value={technician}>
                              {technician}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          value={row.amount}
                          onChange={(e) => updateCompensationRow(row.id, "amount", e.target.value)}
                          className="w-full bg-slate-900 border border-white/10 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                          placeholder="Amount"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          value={row.rate}
                          onChange={(e) => updateCompensationRow(row.id, "rate", e.target.value)}
                          className="w-full bg-slate-900 border border-white/10 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                          placeholder="Rate"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          value={row.activityDate}
                          onChange={(e) => updateCompensationRow(row.id, "activityDate", e.target.value)}
                          className="w-full bg-slate-900 border border-white/10 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                          placeholder="Activity date"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          value={row.requiresClaimOrCxPayment}
                          onChange={(e) => updateCompensationRow(row.id, "requiresClaimOrCxPayment", e.target.value)}
                          className="w-full bg-slate-900 border border-white/10 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                          placeholder="Yes / No"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          value={row.comment}
                          onChange={(e) => updateCompensationRow(row.id, "comment", e.target.value)}
                          className="w-full bg-slate-900 border border-white/10 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                          placeholder="Comment"
                        />
                      </td>
                      <td className="px-4 py-3 text-slate-300">{row.createdBy}</td>
                      <td className="px-4 py-3 text-slate-300">{row.lastModifiedBy}</td>
                      <td className="px-4 py-3 text-slate-300">
                        <button className="text-blue-400 hover:text-blue-300 font-semibold">Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "billing" && (
          <div className="space-y-6">
            <div className="rounded-xl border border-white/15 bg-white/8 p-5 text-white backdrop-blur-md">
              <div className="text-lg font-semibold text-blue-200">Billing Information</div>
              <div className="mt-3 rounded-md border border-white/10 bg-slate-900/90 px-3 py-2 text-sm font-semibold text-white">Paid in full</div>
              <div className="mt-2 text-sm font-semibold text-blue-200/90">0 distinct record found</div>
              <div className="mt-4 max-w-sm">
                <label htmlFor="billing-search" className="block text-xs font-semibold uppercase tracking-[0.04em] text-slate-400">search in result</label>
                <input
                  id="billing-search"
                  type="text"
                  readOnly
                  value=""
                  className="mt-2 w-full rounded-md border border-white/15 bg-slate-900/90 px-3 py-2 text-sm text-white focus:outline-none"
                />
              </div>
              <div className="mt-4 overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full min-w-[1400px] text-left text-sm">
                  <thead>
                    <tr className="bg-blue-900/50 text-blue-200">
                      <th className="px-4 py-3">ID</th>
                      <th className="px-4 py-3">Visit ID*</th>
                      <th className="px-4 py-3">Cx Email</th>
                      <th className="px-4 py-3">Cx Name*</th>
                      <th className="px-4 py-3">Labor Fee*</th>
                      <th className="px-4 py-3">Part Fee*</th>
                      <th className="px-4 py-3">Diag(Trip) Fee*</th>
                      <th className="px-4 py-3">Others Fee*</th>
                      <th className="px-4 py-3">Tax Rate*</th>
                      <th className="px-4 py-3">Tax</th>
                      <th className="px-4 py-3">Deduction</th>
                      <th className="px-4 py-3">Total</th>
                      <th className="px-4 py-3">Payment*</th>
                      <th className="px-4 py-3">C. Card #</th>
                      <th className="px-4 py-3">App. Code</th>
                      <th className="px-4 py-3">Sign</th>
                      <th className="px-4 py-3">Comment</th>
                      <th className="px-4 py-3">Tx Date</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    <tr className="bg-slate-900/70 text-slate-200">
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3">V1</td>
                      <td className="px-4 py-3">jonshaw@lakesidechurch.ws</td>
                      <td className="px-4 py-3">Jon Shaw</td>
                      <td className="px-4 py-3">Tax</td>
                      <td className="px-4 py-3">Tax</td>
                      <td className="px-4 py-3">Tax</td>
                      <td className="px-4 py-3">Tax</td>
                      <td className="px-4 py-3">%</td>
                      <td className="px-4 py-3">$0.00</td>
                      <td className="px-4 py-3">0.00</td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3">05/14/2026</td>
                      <td className="px-4 py-3 text-blue-300 font-semibold">Add</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-xl border border-white/15 bg-white/8 p-5 text-white backdrop-blur-md">
              <div className="text-lg font-semibold text-blue-200">Estimations</div>
              <div className="mt-4 overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full min-w-[1100px] text-left text-sm">
                  <thead>
                    <tr className="bg-blue-900/50 text-blue-200">
                      <th className="px-4 py-3">ID</th>
                      <th className="px-4 py-3">Estimated</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Labor Fee</th>
                      <th className="px-4 py-3">Part Fee</th>
                      <th className="px-4 py-3">Diagnose Fee</th>
                      <th className="px-4 py-3">Others Fee</th>
                      <th className="px-4 py-3">Tax Rate (%)</th>
                      <th className="px-4 py-3">Tax Fee</th>
                      <th className="px-4 py-3">Deduction</th>
                      <th className="px-4 py-3">Refund</th>
                      <th className="px-4 py-3">Total</th>
                      <th className="px-4 py-3">Confirmed</th>
                      <th className="px-4 py-3">Created by</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    <tr className="bg-slate-900/70 text-slate-200">
                      <td className="px-4 py-3" colSpan={14}></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="rounded-md border border-white/15 bg-slate-900/90 px-4 py-2 text-sm font-semibold text-white transition hover:border-slate-200/40">
                  Close
                </button>
                <button className="rounded-md border border-white/15 bg-slate-900/90 px-4 py-2 text-sm font-semibold text-white transition hover:border-slate-200/40">
                  List
                </button>
              </div>
            </div>
          </div>
        )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
