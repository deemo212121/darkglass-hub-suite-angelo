/**
 * Read-only: a ticket's Pre-Auth (Request for Authorization) on ServicePower's
 * Call Auth — the one filed on ServicePower's website or from Claims → Pre-Auth.
 * Looks the call up with retrieveRFA; nothing is created or changed.
 *
 * ServicePower wants the manufacturer name as it has it on file ("GE",
 * "ASSURANT SOLUTIONS", …), so the ticket's claim company, manufacturer and
 * brand are tried in turn (plus the usual short forms) until one finds it.
 */
import type { RFARequest } from "@/types/servicePower";
import { getRFAStatusLabel } from "@/lib/servicePowerApi";

export interface SpPreAuth {
  statusCode: string;
  status: string;
  jobCode: string;
  requestedTotal: number;
  authorizedTotal: number;
  authorizedLabor: number;
  approvedBy: string;
  /** "YYYY-MM-DD" or "". */
  approvedOn: string;
  createdOn: string;
  reason: string;
  manufacturerName: string;
}

/** ServicePower's own spellings for the names on our tickets. */
function nameCandidates(names: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const add = (n: string) => { const v = n.trim(); if (v && !out.some((o) => o.toUpperCase() === v.toUpperCase())) out.push(v); };
  for (const raw of names) {
    const n = String(raw ?? "").trim();
    if (!n) continue;
    if (/^(ge\b|general electric)/i.test(n)) { add("GE"); add("GENERAL ELECTRIC"); continue; }
    if (/assurant/i.test(n)) { add("ASSURANT SOLUTIONS"); add("ASSURANT"); continue; }
    if (/square\s*trade|^sqt\b/i.test(n)) { add("SQUARE TRADE"); continue; }
    if (/electrolux|frigidaire/i.test(n)) { add("ELECTROLUX"); add("FRIGIDAIRE"); continue; }
    add(n);
  }
  return out.slice(0, 5);
}

const day = (v: unknown) => {
  const s = String(v ?? "");
  return /^\d{8}/.test(s) && !/^0+$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : "";
};

function toPreAuth(q: RFARequest): SpPreAuth {
  const a = (q.amounts ?? {}) as Record<string, number | undefined>;
  const audit = (q.auditInfo ?? {}) as Record<string, unknown>;
  const r = q.approvalRejectInfo ?? {};
  return {
    statusCode: q.coreInfo?.rfaStatusCode ?? "",
    status: getRFAStatusLabel(q.coreInfo?.rfaStatusCode),
    jobCode: q.coreInfo?.jobCode ?? "",
    requestedTotal: Number(a.requestedTotal) || 0,
    authorizedTotal: Number(a.authorizedTotal) || 0,
    authorizedLabor: Number(a.authorizedLabor) || 0,
    approvedBy: String(audit.approvedBy ?? ""),
    approvedOn: day(audit.approvedOn),
    createdOn: day(audit.createdOn),
    reason: [r.reasonDescription, r.approvedOrAdditionalInformationRequestNotes].filter((s) => String(s ?? "").trim()).join(" — "),
    manufacturerName: q.manufacturerName ?? "",
  };
}

/** The ticket's latest Call Auth on ServicePower, or null when there's none (or ServicePower can't be reached). */
export async function lookupSpPreAuth(ticketNo: string, names: (string | null | undefined)[], companyId: string | null): Promise<SpPreAuth | null> {
  for (const manufacturerName of nameCandidates(names)) {
    try {
      const res = await fetch("/api/servicepower", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retrieveRFA", params: { callNumber: ticketNo, manufacturerName }, companyId }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const requests: RFARequest[] = Array.isArray(data?.requests) ? data.requests : [];
      const mine = requests.filter((q) => String(q.callNumber ?? "").trim() === ticketNo);
      if (mine.length === 0) continue;
      // Newest first (a call can carry more than one request).
      mine.sort((x, y) => Number((y.auditInfo as any)?.createdOn ?? 0) - Number((x.auditInfo as any)?.createdOn ?? 0));
      return toPreAuth(mine[0]);
    } catch {
      // try the next spelling
    }
  }
  return null;
}
