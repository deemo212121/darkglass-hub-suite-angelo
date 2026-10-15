/**
 * App error log (migration 0379) — saves a failed upload or signing step
 * for the AHS Server Status page, so a SuperAdmin can see what went wrong
 * for a specific person. Who it was is filled in by the database from the
 * session; this only sends what they were doing, the error, their device
 * and the page.
 *
 * Never throws and never blocks the caller — logging an error must not
 * cause another one. The same error from the same place is sent at most
 * once every 30 seconds (a retry loop doesn't flood the log).
 */
import { supabase } from "@/lib/supabase/client";
import { describeDevice } from "@/lib/deviceLabel";

export { describeDevice };

export type AppErrorArea = "upload" | "signing";

const recent = new Map<string, number>();
const REPEAT_WINDOW_MS = 30_000;

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function logAppError(area: AppErrorArea, action: string, err: unknown): void {
  try {
    const message = errorMessage(err);
    // A cancelled popup isn't a failure.
    if (/cancelled — nothing was changed/i.test(message)) return;
    const key = `${area}|${action}|${message}`;
    const now = Date.now();
    if ((recent.get(key) ?? 0) > now - REPEAT_WINDOW_MS) return;
    recent.set(key, now);
    void supabase
      .from("app_error_log")
      .insert({
        area,
        action,
        message,
        device: describeDevice(),
        page: typeof location !== "undefined" ? location.pathname + location.search : null,
      })
      .then(({ error }) => {
        if (error) console.warn("app error log not saved:", error.message);
      });
  } catch {
    /* logging must never fail the caller */
  }
}

/**
 * What a Storage path was for, in words — "Uploading ticket photo (ticket
 * 12345)", "Uploading signature (Time Correction)"… — and whether it is part
 * of signing a paper (signatures / signed PDFs) rather than a plain upload.
 */
export function describeStoragePath(path: string): { area: AppErrorArea; action: string } {
  const parts = path.split("/").filter(Boolean);
  const after = parts[0] === "companies" ? parts.slice(2) : parts;
  const folder = after[0] ?? "";
  const file = parts[parts.length - 1] ?? "";
  const isSignatureFile = /^(employee|manager|hr_staff|accounting|employer|signature)[-_]/i.test(file) || /signature/i.test(file);
  const isPdf = /\.pdf$/i.test(file);
  const words = (f: string) => f.replace(/-forms?$/, " form").replace(/-/g, " ");
  // Folders of signed papers (every "...-forms" folder is one form's signed PDFs).
  const SIGNING_FOLDERS: Record<string, string> = {
    "timecard-corrections": "Time Correction",
    "pto-requests": "leave request",
    "employee-requests": "Ticket Time Dispute",
    "ticket-time-disputes": "Ticket Time Dispute",
    "signable-documents": "HR paper",
    "exception-visit-reports": "exception report",
    "visit-exception-reports": "exception report",
    "onboarding-documents": "onboarding paper",
    "compensation-updates": "compensation update",
  };
  const PLAIN_FOLDERS: Record<string, string> = {
    tickets: "ticket photo",
    expenses: "expense receipt",
    "flash-tech-trip-receipts": "Flash Tech receipt",
    "pto-attachments": "leave proof photo",
    "attendance-note-attachments": "attendance note attachment",
    "it-tickets": "IT ticket attachment",
    "payroll-disputes": "payroll dispute attachment",
    "custom-forms": "custom form file",
  };
  const signingName = SIGNING_FOLDERS[folder] ?? (/-forms?$/.test(folder) ? words(folder) : null);
  if (signingName) return { area: "signing", action: `Uploading ${isSignatureFile ? "signature" : isPdf ? "signed PDF" : "file"} (${signingName})` };
  if (isSignatureFile) return { area: "signing", action: `Uploading signature (${words(folder) || "document"})` };
  const what = PLAIN_FOLDERS[folder] ?? (folder ? words(folder) : "file");
  const ticket = folder === "tickets" && after[1] ? ` — ticket ${after[1]}` : "";
  return { area: "upload", action: `Uploading ${what}${ticket}` };
}
