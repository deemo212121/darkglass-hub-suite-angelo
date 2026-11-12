import { supabase } from "./client";
import { buildNewHireRows, type HireFormDoc, type HireGroup, type HirePerson, type NewHireRow } from "@/lib/newHiresForms";
import { isEligibleForTechnicianFormChecklist } from "@/lib/roleLabels";
import { LOCATIONS_DATA } from "@/lib/zipCoverage";

// Same as Staff Form Checklist (staffFormChecklist.ts): country by branch, then technician by role.
const PH_BRANCHES = new Set(LOCATIONS_DATA.filter((l) => l.isPhilippines).map((l) => l.location));
const MX_BRANCHES = new Set(LOCATIONS_DATA.filter((l) => l.isMexico).map((l) => l.location));

function groupOf(branch: string, role: string, extraRoles: string[] | null): HireGroup {
  if (PH_BRANCHES.has(branch)) return "PH";
  if (MX_BRANCHES.has(branch)) return "MX";
  if (isEligibleForTechnicianFormChecklist(role, extraRoles)) return "TECH";
  return "US";
}

/**
 * Active people hired in [start, end] with every HR form they have (the
 * Forms dropdown picks which to show, no refetch). Reads only the hire date
 * out of employee_info and only the status fields of each form (no form
 * contents, no signatures).
 */
export async function getNewHiresWithForms(start: string, end: string): Promise<NewHireRow[]> {
  const { data: profs, error: pErr } = await supabase
    .from("profiles")
    .select("id, display_name, username, email, role, extra_roles, department, assigned_branch, hire_date:employee_info->>hireDate")
    .eq("is_active", true);
  if (pErr) throw new Error(pErr.message);

  const people: HirePerson[] = ((profs ?? []) as any[]).map((r) => ({
    id: r.id,
    name: (r.display_name || r.username || r.email || "—").trim(),
    role: r.role ?? "",
    branch: r.assigned_branch ?? "",
    department: r.department ?? "",
    hireDate: r.hire_date ?? null,
    group: groupOf(r.assigned_branch ?? "", r.role ?? "", r.extra_roles ?? null),
  }));
  const candidates = buildNewHireRows(people, [], start, end);
  if (candidates.length === 0) return [];

  const ids = candidates.map((c) => c.id);
  const docs: HireFormDoc[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("hr_signable_documents")
      .select("id, document_type, status, recipient_id, recipient_slot, pdf_url, created_at, signed_at, confirmed_at, template_version:form_data->>templateVersion")
      .in("recipient_id", ids.slice(i, i + 200))
      .neq("status", "cancelled");
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as any[]) {
      docs.push({
        id: r.id,
        documentType: r.document_type,
        status: r.status,
        recipientId: r.recipient_id,
        recipientSlot: r.recipient_slot ?? undefined,
        templateVersion: r.template_version ?? null,
        pdfUrl: r.pdf_url ?? null,
        createdAt: r.created_at,
        signedAt: r.signed_at ?? null,
        confirmedAt: r.confirmed_at ?? null,
      });
    }
  }
  return buildNewHireRows(people, docs, start, end);
}
