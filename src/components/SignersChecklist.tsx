import type { SignableDocument, SignableDocumentType, SignatureSlot } from "@/lib/supabase/signableDocuments";

type SlotList = { slot: SignatureSlot; label: string }[];

/** Each multi-signer form's slots, in the order its signature block lists them. */
const SLOTS_BY_TYPE: Partial<Record<SignableDocumentType, SlotList>> = {
  warning_form: [
    { slot: "employee", label: "Employee" },
    { slot: "manager", label: "Manager" },
    { slot: "senior_manager", label: "Senior Manager" },
    { slot: "hr_staff", label: "HR" },
    { slot: "executive", label: "Executive" },
  ],
  promotion_form: [
    { slot: "employee", label: "Employee" },
    { slot: "manager", label: "Direct Manager" },
    { slot: "senior_manager", label: "Senior Manager" },
    { slot: "hr_staff", label: "HR" },
    { slot: "executive", label: "Executive" },
  ],
  action_plan_form: [
    { slot: "manager", label: "Manager" },
    { slot: "senior_manager", label: "Senior Manager" },
    { slot: "hr_staff", label: "HR" },
    { slot: "executive", label: "CEO" },
    { slot: "employee", label: "Employee" },
  ],
  termination_form: [
    { slot: "employee", label: "Employee" },
    { slot: "manager", label: "Manager" },
    { slot: "senior_manager", label: "Senior Manager" },
    { slot: "hr_staff", label: "HR" },
  ],
};

/**
 * Read-only "who has signed" list for a multi-signer HR document — one line
 * per signature slot, in the order the slots appear on the document:
 *   ✓ signed · ● the slot it's currently waiting on · ○ not reached yet.
 * Purely derived from what's already stored (signatures, recipientNames,
 * current recipient) — never writes anything.
 */
export function SignersChecklist({
  doc,
  slots,
  recipientDisplayName,
}: {
  doc: SignableDocument;
  /** Defaults to the document type's own slot order (SLOTS_BY_TYPE). */
  slots?: SlotList;
  /** Resolved name of the current recipient (e.g. from the employee list), used when form data has none. */
  recipientDisplayName?: string | null;
}) {
  const slotList = slots ?? SLOTS_BY_TYPE[doc.documentType] ?? [];
  const data = doc.formData as { recipientName?: string; recipientNames?: Partial<Record<string, string>>; employeeName?: string };
  const open = doc.status === "pending_signature";
  return (
    <div className="text-xs leading-5">
      {slotList.map(({ slot, label }) => {
        const signed = doc.signatures?.[slot];
        const current = open && doc.recipientSlot === slot;
        const name =
          signed?.name ||
          data.recipientNames?.[slot] ||
          (doc.recipientSlot === slot ? data.recipientName || recipientDisplayName || doc.recipientName : "") ||
          (slot === "employee" ? data.employeeName : "") ||
          "—";
        return (
          <div key={slot} className="whitespace-nowrap" title={signed ? `Signed ${new Date(signed.signedAt).toLocaleDateString()}` : current ? "Waiting on this signature" : "Not signed yet"}>
            <span className={signed ? "text-green-400" : current ? "text-amber-300" : "text-slate-500"}>{signed ? "✓" : current ? "●" : "○"}</span>{" "}
            <span className={signed || current ? "text-slate-200" : "text-slate-400"}>{label}: {name}</span>
          </div>
        );
      })}
    </div>
  );
}
