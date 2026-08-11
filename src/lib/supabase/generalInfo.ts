/**
 * General Information — branch management directory (migration 0139).
 * Replaces an external spreadsheet: per-branch role assignments, regional
 * groupings, and top-level leadership titles. Edited on the "General
 * Information" page (Dashboard module).
 */

import { supabase } from "./client";

export interface BranchRoles {
  id: string;
  branch: string;
  seniorBranchManager: string | null;
  branchManager: string | null;
  technicalManager: string | null;
  bizops: string | null;
  regionalTechnicalManager: string | null;
  partsManager: string | null;
  assistantPartsManager: string | null;
  sortOrder: number;
}

export interface Region {
  id: string;
  regionName: string;
  regionLead: string | null;
  branches: string[];
  sortOrder: number;
}

export interface LeadershipRole {
  id: string;
  title: string;
  name: string | null;
  sortOrder: number;
}

function mapBranchRoles(r: any): BranchRoles {
  return {
    id: r.id,
    branch: r.branch,
    seniorBranchManager: r.senior_branch_manager,
    branchManager: r.branch_manager,
    technicalManager: r.technical_manager,
    bizops: r.bizops,
    regionalTechnicalManager: r.regional_technical_manager,
    partsManager: r.parts_manager,
    assistantPartsManager: r.assistant_parts_manager,
    sortOrder: r.sort_order,
  };
}

export async function getBranchRoles(): Promise<BranchRoles[]> {
  const { data, error } = await supabase
    .from("general_info_branch_roles")
    .select("id, branch, senior_branch_manager, branch_manager, technical_manager, bizops, regional_technical_manager, parts_manager, assistant_parts_manager, sort_order")
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("getBranchRoles error:", error.message);
    return [];
  }
  return (data ?? []).map(mapBranchRoles);
}

export async function upsertBranchRole(input: {
  id?: string;
  branch: string;
  seniorBranchManager: string;
  branchManager: string;
  technicalManager: string;
  bizops: string;
  regionalTechnicalManager: string;
  partsManager: string;
  assistantPartsManager: string;
  sortOrder?: number;
}): Promise<void> {
  const payload = {
    branch: input.branch,
    senior_branch_manager: input.seniorBranchManager || null,
    branch_manager: input.branchManager || null,
    technical_manager: input.technicalManager || null,
    bizops: input.bizops || null,
    regional_technical_manager: input.regionalTechnicalManager || null,
    parts_manager: input.partsManager || null,
    assistant_parts_manager: input.assistantPartsManager || null,
    updated_at: new Date().toISOString(),
  };
  if (input.id) {
    const { error } = await supabase.from("general_info_branch_roles").update(payload).eq("id", input.id);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await supabase
    .from("general_info_branch_roles")
    .insert({ ...payload, sort_order: input.sortOrder ?? 0 });
  if (error) throw new Error(error.message);
}

export async function deleteBranchRole(id: string): Promise<void> {
  const { error } = await supabase.from("general_info_branch_roles").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

function mapRegion(r: any): Region {
  return {
    id: r.id,
    regionName: r.region_name,
    regionLead: r.region_lead,
    branches: r.branches ?? [],
    sortOrder: r.sort_order,
  };
}

export async function getRegions(): Promise<Region[]> {
  const { data, error } = await supabase
    .from("general_info_regions")
    .select("id, region_name, region_lead, branches, sort_order")
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("getRegions error:", error.message);
    return [];
  }
  return (data ?? []).map(mapRegion);
}

export async function upsertRegion(input: {
  id?: string;
  regionName: string;
  regionLead: string;
  branches: string[];
  sortOrder?: number;
}): Promise<void> {
  const payload = {
    region_name: input.regionName,
    region_lead: input.regionLead || null,
    branches: input.branches,
  };
  if (input.id) {
    const { error } = await supabase.from("general_info_regions").update(payload).eq("id", input.id);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await supabase
    .from("general_info_regions")
    .insert({ ...payload, sort_order: input.sortOrder ?? 0 });
  if (error) throw new Error(error.message);
}

export async function deleteRegion(id: string): Promise<void> {
  const { error } = await supabase.from("general_info_regions").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

function mapLeadership(r: any): LeadershipRole {
  return { id: r.id, title: r.title, name: r.name, sortOrder: r.sort_order };
}

export async function getLeadership(): Promise<LeadershipRole[]> {
  const { data, error } = await supabase
    .from("general_info_leadership")
    .select("id, title, name, sort_order")
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("getLeadership error:", error.message);
    return [];
  }
  return (data ?? []).map(mapLeadership);
}

export async function upsertLeadership(input: { id?: string; title: string; name: string; sortOrder?: number }): Promise<void> {
  const payload = { title: input.title, name: input.name || null };
  if (input.id) {
    const { error } = await supabase.from("general_info_leadership").update(payload).eq("id", input.id);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await supabase
    .from("general_info_leadership")
    .insert({ ...payload, sort_order: input.sortOrder ?? 0 });
  if (error) throw new Error(error.message);
}

export async function deleteLeadership(id: string): Promise<void> {
  const { error } = await supabase.from("general_info_leadership").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export interface Abbreviation {
  id: string;
  category: string;
  abbreviation: string;
  meaning: string | null;
  sortOrder: number;
}

function mapAbbreviation(r: any): Abbreviation {
  return { id: r.id, category: r.category, abbreviation: r.abbreviation, meaning: r.meaning, sortOrder: r.sort_order };
}

export async function getAbbreviations(): Promise<Abbreviation[]> {
  const { data, error } = await supabase
    .from("general_info_abbreviations")
    .select("id, category, abbreviation, meaning, sort_order")
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("getAbbreviations error:", error.message);
    return [];
  }
  return (data ?? []).map(mapAbbreviation);
}

export async function upsertAbbreviation(input: {
  id?: string;
  category: string;
  abbreviation: string;
  meaning: string;
  sortOrder?: number;
}): Promise<void> {
  const payload = { category: input.category, abbreviation: input.abbreviation, meaning: input.meaning || null };
  if (input.id) {
    const { error } = await supabase.from("general_info_abbreviations").update(payload).eq("id", input.id);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await supabase
    .from("general_info_abbreviations")
    .insert({ ...payload, sort_order: input.sortOrder ?? 0 });
  if (error) throw new Error(error.message);
}

export async function deleteAbbreviation(id: string): Promise<void> {
  const { error } = await supabase.from("general_info_abbreviations").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
