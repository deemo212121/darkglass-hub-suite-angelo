import { useState } from "react";
import { X } from "lucide-react";
import { useTicketDetails } from "@/lib/ticket-details-context";

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

export function TicketDetailsModal() {
  const { selectedTicketNo, setSelectedTicketNo } = useTicketDetails();
  const [activeTab, setActiveTab] = useState<"general" | "tracking" | "compensation" | "billing">("general");
  const [newServicerNote, setNewServicerNote] = useState("");

  if (!selectedTicketNo) return null;

  const ticket = SAMPLE_TICKET; // In production, fetch by ticketNo
  const isOpen = !!selectedTicketNo;

  const addServicerNote = () => {
    if (newServicerNote.trim()) {
      ticket.servicerNotes.push({
        notes: newServicerNote,
        by: "Current User", // Replace with actual user
      });
      setNewServicerNote("");
    }
  };

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-50"
          onClick={() => setSelectedTicketNo(null)}
        />
      )}

      {/* Modal */}
      <div
        className={`fixed right-0 top-0 h-screen w-full max-w-4xl bg-slate-950 border-l border-white/10 overflow-y-auto transition-transform duration-300 z-50 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="sticky top-0 bg-slate-900/95 backdrop-blur border-b border-white/10 p-6 flex justify-between items-start">
          <div>
            <h2 className="text-2xl font-bold text-white">Ticket #{ticket.ticketNo}</h2>
            <div className="flex gap-6 mt-2 text-sm text-slate-400">
              <div><span className="font-semibold text-blue-400">Account:</span> {ticket.account}</div>
              <div><span className="font-semibold text-blue-400">Wty:</span> {ticket.warranty}</div>
              <div><span className="font-semibold text-blue-400">Status:</span> <span className="text-blue-300">{ticket.status}</span></div>
            </div>
          </div>
          <button
            onClick={() => setSelectedTicketNo(null)}
            className="text-slate-400 hover:text-white transition"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Tabs */}
        <div className="bg-slate-900/50 border-b border-white/10 px-6 flex gap-8">
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

        {/* Content */}
        <div className="p-6">
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
                <div className="space-y-4">
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
            <div className="text-slate-400 py-12 text-center">
              <p>Service Tracking information coming soon...</p>
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
      </div>
    </>
  );
}
