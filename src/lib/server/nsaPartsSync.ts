/**
 * Hourly Cron Trigger job (see scheduled() in src/server.ts): for every open
 * NSA ticket, pull the current parts list from NSA and insert any parts we
 * don't already have. Mirrors the exact field mapping + Change Log pattern
 * established by the manual pulls this session — this just runs it on a
 * schedule instead of by hand.
 *
 * Deliberately scoped to parts only. Re-applying NSA's ticket-level fields
 * (status, schedule, ...) on a timer risks silently overwriting a local
 * AHS staff edit — a materially different, riskier feature than "don't
 * miss new parts," so it's left out.
 */

import { handleNsaRequest } from "./nsaBridge";

interface SyncSummary {
  ticketsChecked: number;
  partsAdded: number;
  errors: string[];
}

function resolveCreds(env: Record<string, string | undefined>) {
  const g = globalThis as any;
  const supabaseUrl =
    (g.__SUPABASE_URL__ && g.__SUPABASE_URL__ !== "" ? g.__SUPABASE_URL__ : undefined) ??
    env.VITE_SUPABASE_URL;
  const supabaseServiceKey =
    (g.__SUPABASE_SERVICE_KEY__ && g.__SUPABASE_SERVICE_KEY__ !== "" ? g.__SUPABASE_SERVICE_KEY__ : undefined) ??
    env.SUPABASE_SERVICE_KEY;
  return { supabaseUrl, supabaseServiceKey };
}

async function callNsa(env: Record<string, string | undefined>, action: string, params: Record<string, any>) {
  const req = new Request("http://internal/api/nsa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, params }),
  });
  const res = await handleNsaRequest(req, env);
  const json: any = await res.json();
  if (!json.success) {
    throw new Error(json.data?.message || json.data?.error || `NSA ${action} failed: ${json.status}`);
  }
  return json.data;
}

export async function runNsaPartsSync(env: Record<string, string | undefined>): Promise<SyncSummary> {
  const summary: SyncSummary = { ticketsChecked: 0, partsAdded: 0, errors: [] };
  const { supabaseUrl, supabaseServiceKey } = resolveCreds(env);
  if (!supabaseUrl || !supabaseServiceKey) {
    summary.errors.push("Missing Supabase URL/service key — cannot run.");
    return summary;
  }
  const sbHeaders = {
    apikey: supabaseServiceKey,
    Authorization: `Bearer ${supabaseServiceKey}`,
    "Content-Type": "application/json",
  };

  const ticketsRes = await fetch(
    `${supabaseUrl}/rest/v1/tickets?ticket_source=ilike.NSA*&status=not.in.(CL-Completed,CL-Cancelled)&select=id,ticket_no,company_id`,
    { headers: sbHeaders },
  );
  if (!ticketsRes.ok) {
    summary.errors.push(`Failed to list NSA tickets: HTTP ${ticketsRes.status}`);
    return summary;
  }
  const tickets: Array<{ id: string; ticket_no: string; company_id: string }> = await ticketsRes.json();

  for (const ticket of tickets) {
    summary.ticketsChecked++;
    try {
      const data = await callNsa(env, "getDispatchParts", { dispatchNumber: ticket.ticket_no });
      const nsaParts: any[] = Array.isArray(data?.Parts) ? data.Parts : [];
      if (nsaParts.length === 0) continue;

      const existingRes = await fetch(
        `${supabaseUrl}/rest/v1/parts?ticket_id=eq.${ticket.id}&nsa_part_id=not.is.null&select=nsa_part_id`,
        { headers: sbHeaders },
      );
      if (!existingRes.ok) throw new Error(`Failed to list existing parts: HTTP ${existingRes.status}`);
      const existing: Array<{ nsa_part_id: string }> = await existingRes.json();
      const existingIds = new Set(existing.map((r) => r.nsa_part_id));

      for (const p of nsaParts) {
        const nsaPartId = String(p.ID ?? "").trim();
        if (!nsaPartId || existingIds.has(nsaPartId)) continue;

        // Matches the manual pull's mapping exactly (see the session's earlier
        // one-off pull for this ticket) — hardcoded, not conditional on NSA's
        // own status, since that mapping decision hasn't been revisited here.
        const status = "Part Ready";
        const partPayload = {
          ticket_id: ticket.id,
          company_id: ticket.company_id,
          nsa_part_id: nsaPartId,
          part_no: p.PartNumber ?? null,
          part_dist: "NSA",
          part_desc: p.Description ?? null,
          quantity: p.Quantity ?? 1,
          part_price: p.PartCost ?? 0,
          status,
          po_no: p.PONumber ?? null,
          po_date: p.OrderDate ?? null,
          eta: p.DueDate ?? null,
          invoice_no: p.Vendor_Invoice ?? null,
          in_tracking: p.ShippingNum ?? null,
          order_no: p.OrdConfirmNumber ?? null,
          claim_to: "NSA",
          note: `${p.brand ?? p.Brand ?? ""} part via ${p.Supplier ?? p.SFSupplier ?? ""} (NSA order ${p.NsaOrderID ?? ""})`.trim(),
        };
        const insertRes = await fetch(`${supabaseUrl}/rest/v1/parts`, {
          method: "POST",
          headers: { ...sbHeaders, Prefer: "return=representation" },
          body: JSON.stringify(partPayload),
        });
        if (!insertRes.ok) {
          const body = await insertRes.text();
          throw new Error(`Insert failed for part ${partPayload.part_no}: HTTP ${insertRes.status} ${body}`);
        }

        const summaryLine = `Part No: ${partPayload.part_no} | Part Dist: NSA | Part Desc: ${partPayload.part_desc} | Qty: ${partPayload.quantity} | Part Price: ${partPayload.part_price} | Status: ${status} | PO No: ${partPayload.po_no}`;
        await fetch(`${supabaseUrl}/rest/v1/ticket_audit_log`, {
          method: "POST",
          headers: sbHeaders,
          body: JSON.stringify({
            ticket_id: ticket.id,
            company_id: ticket.company_id,
            action: "Added part transaction (pulled from NSA)",
            field: "Part Transaction",
            before_value: "—",
            after_value: summaryLine,
            changed_by: null,
          }),
        }).catch(() => {}); // best-effort — a missed Change Log line never blocks the part itself

        existingIds.add(nsaPartId);
        summary.partsAdded++;
      }
    } catch (e) {
      summary.errors.push(`${ticket.ticket_no}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return summary;
}
