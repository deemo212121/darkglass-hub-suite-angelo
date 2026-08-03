import { useState, useMemo } from "react";
import { ChevronLeft, Edit2, Trash2, Send, Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

interface PartTransaction {
  id: string;
  partNo: string;
  partDist: string;
  partDescription: string;
  poNo: string;
  poDate: string;
  invoiceNo: string;
  invoiceDate: string;
  qty: string;
  partPrice: string;
  coreValue: string;
  shipCost: string;
  markup: string;
  claimTo: string;
  partStatus: string;
  note: string;
  visitId: string;
  orderNo: string;
  eta: string;
  inTracking: string;
  raDate: string;
  raNo: string;
  outTracking: string;
  creditNo: string;
  total: number;
  hold: boolean;
  cxPaid: boolean;
}

const PART_STATUSES = [
  "Back Order",
  "Cancelled",
  "Claimed",
  "CX Home",
  "CX Received",
  "Defective",
  "Hold for Estimation",
  "Hold for next visit",
  "Lost",
  "Need PO",
  "Not Used & Stocked",
  "PAID",
  "Part Ready",
  "PO Made",
  "RA - Defect",
  "RA - DMG",
  "RA - PNN",
  "RA - Qty Discrepancy",
  "SQT Received",
  "Tech Pickup",
  "Used",
];

const PART_DISTRIBUTORS = [
  "Encompass",
  "Marcone",
  "Johnstone",
  "Other",
];

interface Props {
  mod: ModuleDef;
  sub: SubModuleDef;
}

export function PartTransactionManager({ mod, sub }: Props) {
  const [transactions, setTransactions] = useState<PartTransaction[]>([
    {
      id: "1",
      partNo: "WR49X10251",
      partDist: "Encompass",
      partDescription: "COVER ASM FF INLET",
      poNo: "SA-3128687-AV",
      poDate: "2026-05-20",
      invoiceNo: "INV-001",
      invoiceDate: "2026-05-21",
      qty: "1",
      partPrice: "45.50",
      coreValue: "5.00",
      shipCost: "8.50",
      markup: "10.00",
      claimTo: "Claim",
      partStatus: "Part Ready",
      note: "In stock",
      visitId: "V001",
      orderNo: "ORD-001",
      eta: "2026-05-25",
      inTracking: "TRK-123456",
      raDate: "",
      raNo: "",
      outTracking: "",
      creditNo: "",
      total: 64.00,
      hold: false,
      cxPaid: false,
    },
  ]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<PartTransaction>>({});
  const [showForm, setShowForm] = useState(false);
  const [selectedForPO, setSelectedForPO] = useState<Set<string>>(new Set());

  const handleEdit = (transaction: PartTransaction) => {
    setEditingId(transaction.id);
    setEditForm(transaction);
    setShowForm(true);
  };

  const handleSaveEdit = () => {
    if (!editingId) return;
    setTransactions(
      transactions.map((t) =>
        t.id === editingId ? { ...t, ...editForm } : t
      )
    );
    setEditingId(null);
    setEditForm({});
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    if (!confirm("Are you sure you want to delete this part transaction?")) return;
    setTransactions(transactions.filter((t) => t.id !== id));
  };

  const handleAddNew = () => {
    setEditingId(null);
    setEditForm({
      id: `${Date.now()}`,
      partNo: "",
      partDist: "",
      partDescription: "",
      poNo: "",
      poDate: new Date().toISOString().split("T")[0],
      invoiceNo: "",
      invoiceDate: "",
      qty: "1",
      partPrice: "",
      coreValue: "",
      shipCost: "",
      markup: "",
      claimTo: "",
      partStatus: "Need PO",
      note: "",
      visitId: "",
      orderNo: "",
      eta: "",
      inTracking: "",
      raDate: "",
      raNo: "",
      outTracking: "",
      creditNo: "",
      total: 0,
      hold: false,
      cxPaid: false,
    });
    setShowForm(true);
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditForm({});
    setShowForm(false);
  };

  const toggleSelectedForPO = (id: string) => {
    const newSelected = new Set(selectedForPO);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedForPO(newSelected);
  };

  const handleSubmitPO = () => {
    if (selectedForPO.size === 0) {
      alert("Please select at least one part to submit for PO");
      return;
    }

    const selectedParts = transactions.filter((t) => selectedForPO.has(t.id));
    const poData = {
      submittedAt: new Date().toISOString(),
      parts: selectedParts,
      totalCost: selectedParts.reduce((sum, p) => sum + p.total, 0),
    };

    console.log("Submitting PO:", poData);
    alert(`PO submitted for ${selectedForPO.size} part(s)!\nTotal: $${poData.totalCost.toFixed(2)}`);

    // Mark parts as "PO Made"
    setTransactions(
      transactions.map((t) =>
        selectedForPO.has(t.id) ? { ...t, partStatus: "PO Made" } : t
      )
    );

    setSelectedForPO(new Set());
  };

  const selectedCount = selectedForPO.size;
  const selectedTotal = transactions
    .filter((t) => selectedForPO.has(t.id))
    .reduce((sum, t) => sum + t.total, 0);

  return (
    <main className="min-h-screen bg-slate-950 py-6">
      <div className="max-w-full mx-auto px-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> {mod.label}
            </Link>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">{sub.title}</h1>
          <p className="text-slate-400">{sub.description}</p>
        </div>

        {/* Action Bar */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <button
            onClick={handleAddNew}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Part
          </button>

          {selectedCount > 0 && (
            <>
              <div className="text-sm text-slate-300">
                {selectedCount} part(s) selected · Total: ${selectedTotal.toFixed(2)}
              </div>
              <button
                onClick={handleSubmitPO}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-colors ml-auto"
              >
                <Send className="h-4 w-4" />
                Submit PO
              </button>
            </>
          )}
        </div>

        {/* Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-900 border border-white/20 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-slate-900 border-b border-white/20 px-6 py-4 flex items-center justify-between">
                <h2 className="text-xl font-bold text-white">
                  {editingId ? "Edit Part Transaction" : "Add New Part"}
                </h2>
                <button
                  onClick={handleCancel}
                  className="text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-300 mb-2">
                      Part No *
                    </label>
                    <input
                      type="text"
                      value={editForm.partNo || ""}
                      onChange={(e) => setEditForm({ ...editForm, partNo: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                      placeholder="e.g., WR49X10251"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-300 mb-2">
                      Part Distributor
                    </label>
                    <select
                      value={editForm.partDist || ""}
                      onChange={(e) => setEditForm({ ...editForm, partDist: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                    >
                      <option value="">Select...</option>
                      {PART_DISTRIBUTORS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-semibold text-slate-300 mb-2">
                      Part Description
                    </label>
                    <input
                      type="text"
                      value={editForm.partDescription || ""}
                      onChange={(e) =>
                        setEditForm({ ...editForm, partDescription: e.target.value })
                      }
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                      placeholder="e.g., COVER ASM FF INLET"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-300 mb-2">
                      PO No
                    </label>
                    <input
                      type="text"
                      value={editForm.poNo || ""}
                      onChange={(e) => setEditForm({ ...editForm, poNo: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-300 mb-2">
                      PO Date
                    </label>
                    <input
                      type="date"
                      value={editForm.poDate || ""}
                      onChange={(e) => setEditForm({ ...editForm, poDate: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-300 mb-2">
                      Quantity *
                    </label>
                    <input
                      type="number"
                      value={editForm.qty || ""}
                      onChange={(e) => setEditForm({ ...editForm, qty: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                      min="1"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-300 mb-2">
                      Part Price $
                    </label>
                    <input
                      type="number"
                      value={editForm.partPrice || ""}
                      onChange={(e) => setEditForm({ ...editForm, partPrice: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                      step="0.01"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-300 mb-2">
                      Status
                    </label>
                    <select
                      value={editForm.partStatus || ""}
                      onChange={(e) => setEditForm({ ...editForm, partStatus: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                    >
                      {PART_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-semibold text-slate-300 mb-2">
                      Note
                    </label>
                    <textarea
                      value={editForm.note || ""}
                      onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-blue-500 resize-none"
                      rows={3}
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-white/20 px-6 py-4 flex justify-end gap-3">
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="bg-slate-900/50 border border-white/10 rounded-lg overflow-x-auto">
          <table className="w-full text-sm text-slate-300">
            <thead>
              <tr className="border-b border-white/10 bg-slate-900">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase">
                  <input
                    type="checkbox"
                    checked={
                      transactions.length > 0 &&
                      selectedForPO.size === transactions.length
                    }
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedForPO(new Set(transactions.map((t) => t.id)));
                      } else {
                        setSelectedForPO(new Set());
                      }
                    }}
                    className="w-4 h-4 cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase">
                  Part No
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase">
                  Distributor
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase">
                  Description
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase">
                  PO No
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase">
                  Qty
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase">
                  Price
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase">
                  Total
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                    No part transactions yet. Click "Add Part" to create one.
                  </td>
                </tr>
              ) : (
                transactions.map((transaction) => (
                  <tr
                    key={transaction.id}
                    className={`border-b border-white/5 hover:bg-white/5 transition ${
                      selectedForPO.has(transaction.id) ? "bg-blue-500/10" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedForPO.has(transaction.id)}
                        onChange={() => toggleSelectedForPO(transaction.id)}
                        className="w-4 h-4 cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-blue-400">
                      {transaction.partNo}
                    </td>
                    <td className="px-4 py-3">{transaction.partDist}</td>
                    <td className="px-4 py-3 max-w-xs truncate">
                      {transaction.partDescription}
                    </td>
                    <td className="px-4 py-3">{transaction.poNo || "—"}</td>
                    <td className="px-4 py-3 text-right">{transaction.qty}</td>
                    <td className="px-4 py-3 text-right">
                      ${parseFloat(transaction.partPrice || "0").toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30">
                        {transaction.partStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      ${transaction.total.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleEdit(transaction)}
                          className="p-1.5 hover:bg-blue-500/20 rounded text-blue-400 hover:text-blue-300 transition"
                          title="Edit"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(transaction.id)}
                          className="p-1.5 hover:bg-red-500/20 rounded text-red-400 hover:text-red-300 transition"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
