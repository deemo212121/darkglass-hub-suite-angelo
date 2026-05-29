import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";

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

const SAMPLE_TICKET: TicketData = {
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

  // Sample ticket numbers for dropdown
  const availableTickets = [
    "017151274136",
    "039873174136",
    "026000671769DF1",
    "SA-3458831",
    "26000679102DF",
  ];

  const handleTicketChange = (newTicketNo: string) => {
    setSelectedTicket(newTicketNo);
    navigate({ to: `/ticket/${newTicketNo}` });
  };

  // In production, fetch ticket by ticketNo
  const ticket = SAMPLE_TICKET;

  const addServicerNote = () => {
    if (newServicerNote.trim()) {
      ticket.servicerNotes.push({
        notes: newServicerNote,
        by: "Current User",
      });
      setNewServicerNote("");
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1 bg-slate-950">
        <div className="bg-slate-900/95 backdrop-blur border-b border-white/10 p-6">
          <div className="max-w-6xl mx-auto">
            <div className="mb-4 flex items-center gap-4">
              <label className="text-slate-400 font-semibold">Select Ticket:</label>
              <select
                value={selectedTicket}
                onChange={(e) => handleTicketChange(e.target.value)}
                className="bg-slate-900 border border-white/20 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              >
                {availableTickets.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">Ticket #{ticket.ticketNo}</h1>
              <div className="flex gap-6 mt-2 text-sm text-slate-400">
                <div><span className="font-semibold text-blue-400">Account:</span> {ticket.account}</div>
                <div><span className="font-semibold text-blue-400">Wty:</span> {ticket.warranty}</div>
                <div><span className="font-semibold text-blue-400">Status:</span> <span className="text-blue-300">{ticket.status}</span></div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-slate-900/50 border-b border-white/10 sticky top-0 z-40">
          <div className="max-w-6xl mx-auto px-6 flex gap-8">
            {["general", "tracking", "compensation", "billing"].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                className={`py-4 px-2 font-semibold text-sm transition-all border-b-2 ${
                  activeTab === tab
                    ? "text-blue-400 border-blue-400"
                    : "text-slate-400 border-transparent hover:text-slate-300"
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1).replace(/([A-Z])/g, " $1")}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="max-w-6xl mx-auto p-6">
        {activeTab === "general" && (
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
          <div className="text-slate-400 py-12 text-center">
            <p>Compensation details coming soon...</p>
          </div>
        )}

        {activeTab === "billing" && (
          <div className="text-slate-400 py-12 text-center">
            <p>Billing information coming soon...</p>
          </div>
        )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
