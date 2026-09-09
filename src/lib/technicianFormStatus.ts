/**
 * A frozen technician's own "which Technician-tab forms do I still need to
 * sign" list — powers FrozenAccountModal.tsx on both desktop and mobile.
 * The actual logic now lives in signableDocuments.ts as
 * getIncompleteTechnicianForms (signDocument's auto-unfreeze check needs
 * the exact same answer, so it's kept in one place rather than two) — this
 * file just re-exports it under the name/module this popup was written
 * against, so nothing else needs to change.
 */
export { getIncompleteTechnicianForms as getMyIncompleteTechForms, type IncompleteTechForm } from "@/lib/supabase/signableDocuments";
