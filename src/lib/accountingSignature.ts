/**
 * Accounting's sign-off on an exception-report approval (migration 0376) —
 * the same as the Manager's: required Accounting Comments + a signature,
 * stamped in the PDF's "7. Accounting Approval" section.
 *
 * reviewPtoStage / reviewCorrectionStage call askAccountingSignature() when
 * Accounting approves an exception-report row without a signature, so every
 * Accounting Approve button anywhere in the app gets the popup without each
 * screen wiring its own (same idea as rejectReason.ts). AccountingSignHost
 * (mounted once in __root.tsx) registers the real popup.
 */

export interface AccountingSignResult {
  comments: string;
  /** The signature image (PNG data URL). */
  dataUrl: string;
}

type Asker = (opts: { title: string; reviewerName: string }) => Promise<AccountingSignResult | null>;

let asker: Asker | null = null;

export function registerAccountingSignAsker(fn: Asker | null): void {
  asker = fn;
}

/** Resolves to the comments + signature, or null if cancelled (or no popup is mounted). */
export async function askAccountingSignature(title: string, reviewerName: string): Promise<AccountingSignResult | null> {
  if (!asker) return null;
  return asker({ title, reviewerName });
}
