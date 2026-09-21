/**
 * Recruitment Site tab (HR Dashboard) — a manually-kept mirror of HR's real
 * ZipRecruiter/Indeed job postings. See migration 0294. One row per
 * posting, no date scoping (an ongoing list, not a daily snapshot).
 */
import { supabase } from "./client";

export type HrJobPostingPlatform = "zip_recruiter" | "indeed";
export type HrJobPostingStatus = "open" | "paused" | "closed";

export interface HrJobPosting {
  id: string;
  platform: HrJobPostingPlatform;
  jobTitle: string;
  location: string;
  candidatesAll: number;
  candidatesNew: number;
  sponsoredPlan: string;
  costDaily: number | null;
  costTotal: number | null;
  datePosted: string | null;
  assigneeId: string | null;
  status: HrJobPostingStatus;
  starred: boolean;
}

const SELECT = "id, platform, job_title, location, candidates_all, candidates_new, sponsored_plan, cost_daily, cost_total, date_posted, assignee_id, status, starred";

function fromRow(r: any): HrJobPosting {
  return {
    id: r.id,
    platform: r.platform,
    jobTitle: r.job_title || "",
    location: r.location || "",
    candidatesAll: r.candidates_all ?? 0,
    candidatesNew: r.candidates_new ?? 0,
    sponsoredPlan: r.sponsored_plan || "",
    costDaily: r.cost_daily != null ? Number(r.cost_daily) : null,
    costTotal: r.cost_total != null ? Number(r.cost_total) : null,
    datePosted: r.date_posted,
    assigneeId: r.assignee_id,
    status: r.status,
    starred: !!r.starred,
  };
}

export async function getHrJobPostings(): Promise<HrJobPosting[]> {
  const { data, error } = await supabase
    .from("hr_job_postings")
    .select(SELECT)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromRow);
}

export async function addHrJobPosting(platform: HrJobPostingPlatform): Promise<HrJobPosting> {
  const { data, error } = await supabase
    .from("hr_job_postings")
    .insert({ platform })
    .select(SELECT)
    .single();
  if (error) throw new Error(error.message);
  return fromRow(data);
}

export type HrJobPostingFields = Partial<Pick<HrJobPosting,
  "jobTitle" | "location" | "candidatesAll" | "candidatesNew" | "sponsoredPlan" | "costDaily" | "costTotal" | "datePosted" | "assigneeId" | "status" | "starred">>;

export async function updateHrJobPosting(id: string, fields: HrJobPostingFields): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (fields.jobTitle !== undefined) patch.job_title = fields.jobTitle;
  if (fields.location !== undefined) patch.location = fields.location || null;
  if (fields.candidatesAll !== undefined) patch.candidates_all = fields.candidatesAll;
  if (fields.candidatesNew !== undefined) patch.candidates_new = fields.candidatesNew;
  if (fields.sponsoredPlan !== undefined) patch.sponsored_plan = fields.sponsoredPlan || null;
  if (fields.costDaily !== undefined) patch.cost_daily = fields.costDaily;
  if (fields.costTotal !== undefined) patch.cost_total = fields.costTotal;
  if (fields.datePosted !== undefined) patch.date_posted = fields.datePosted || null;
  if (fields.assigneeId !== undefined) patch.assignee_id = fields.assigneeId || null;
  if (fields.status !== undefined) patch.status = fields.status;
  if (fields.starred !== undefined) patch.starred = fields.starred;
  const { error } = await supabase.from("hr_job_postings").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteHrJobPosting(id: string): Promise<void> {
  const { error } = await supabase.from("hr_job_postings").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
