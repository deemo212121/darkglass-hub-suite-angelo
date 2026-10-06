/**
 * Read-receipt marks: one check = Sent, two grey checks = Delivered, two
 * blue checks = Seen. `withText` adds the word ("Seen 3:25 PM").
 */
import { Check, CheckCheck } from "lucide-react";
import { receiptText, type DmReceiptState, type ReceiptStatus } from "@/lib/supabase/readReceipts";

export function ReceiptMark({ status, state, withText = false, className = "" }: { status: ReceiptStatus; state?: DmReceiptState | null; withText?: boolean; className?: string }) {
  const label = receiptText(status, state);
  return (
    <span className={`receipt receipt--${status} ${className}`} title={label} aria-label={label}>
      {status === "sent" ? <Check /> : <CheckCheck />}
      {withText && <span>{label}</span>}
    </span>
  );
}
