/**
 * Builds the ServicePower Request for Authorization (Create RFA) body from a
 * Pre-Auth form — what Claims → Pre-Auth shows under "Preview what would be
 * sent". Building it sends nothing; only sendPreAuthRFA does.
 *
 * To confirm against ServicePower's RFA guide before sending is switched on:
 * the RFA types we have carry no separate Job Code or Repair Description
 * field, so the job code goes in faultCode and the repair description is
 * put in front of whyHigherRate.
 */
import type { CreateRFARequest } from "@/types/servicePower";
import type { Ticket } from "@/lib/ticketData";
import type { PreAuthForm, YesNo } from "@/lib/supabase/preAuth";

const yn = (v: YesNo) => (v === "Y" || v === "N" ? v : undefined);
const num = (v: string) => {
  const n = Number(String(v ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : undefined;
};
const clip = (v: string | undefined, n: number) => (v ?? "").trim().slice(0, n) || undefined;

export function buildPreAuthRFA(ticket: Ticket, f: PreAuthForm): Omit<CreateRFARequest, "authentication"> {
  const parts = f.parts
    .filter((p) => p.partNumber.trim())
    .map((p, i) => ({
      partSequenceNumber: i + 1,
      quantity: num(p.quantity) ?? 1,
      partNumber: p.partNumber.trim(),
      partDescription: clip(p.description, 30) ?? "",
      singlePartCost: num(p.price) ?? 0,
    }));
  return {
    manufacturerName: clip(ticket.manufacturer, 30),
    callNumber: ticket.ticketNo,
    faultCode: clip(f.jobCode, 4),
    coreInfo: {
      additionalManRequired: yn(f.additionalMan),
      estimatedHoursOnJob: num(f.estHours),
      estimatedMinutesOnJob: num(f.estMinutes),
      isProductRepaired: yn(f.productRepaired),
      laborInWarranty: yn(f.laborInWarranty),
      oemAuthorizedWithManufacturer: yn(f.oemAuthorized),
      partsInWarranty: yn(f.partsInWarranty),
      whyHigherRate: clip([f.repairDescription, f.whyHigherRate].filter((s) => s.trim()).join(" — "), 500),
    },
    productInfo: { newBrand: clip(f.newBrand, 30) },
    amounts: {
      requestedLabor: num(f.labor),
      requestedMiles: num(f.miles),
      requestedRatePerMile: num(f.ratePerMile),
      requestedTravel: num(f.travel),
      requestedOther: num(f.other),
    },
    parts: parts.length ? parts : undefined,
  };
}
