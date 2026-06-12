/**
 * Supabase Client for AH Solutions
 * 
 * This is the main Supabase interface.
 * Currently uses mock implementation until Supabase is ready.
 * 
 * IMPORTANT: When Supabase is ready, replace mockSupabase with real client:
 * import { createClient } from '@supabase/supabase-js'
 * 
 * const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
 * const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
 * export const supabase = createClient(supabaseUrl, supabaseKey)
 */

import { mockSupabase } from "./mock";

// Export mock for now
export const supabase = mockSupabase;

// Type definitions for Supabase database schema
export interface Database {
  public: {
    Tables: {
      tickets: {
        Row: TicketRow;
        Insert: TicketInsert;
        Update: TicketUpdate;
      };
      parts: {
        Row: PartRow;
        Insert: PartInsert;
        Update: PartUpdate;
      };
      visits: {
        Row: VisitRow;
        Insert: VisitInsert;
        Update: VisitUpdate;
      };
      employees: {
        Row: EmployeeRow;
        Insert: EmployeeInsert;
        Update: EmployeeUpdate;
      };
    };
  };
}

// Ticket types
export interface TicketRow {
  id: string;
  ticket_no: string;
  company_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  location: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface TicketInsert {
  ticket_no: string;
  company_id: string;
  customer_name: string;
  customer_phone?: string;
  customer_email?: string;
  location: string;
  status: string;
}

export interface TicketUpdate {
  status?: string;
  updated_at?: string;
}

// Part types
export interface PartRow {
  id: string;
  ticket_id: string;
  part_no: string;
  part_distributor: string;
  description: string;
  quantity: number;
  price: number;
  status: string;
  po_no?: string;
  created_at: string;
  updated_at: string;
}

export interface PartInsert {
  ticket_id: string;
  part_no: string;
  part_distributor: string;
  description: string;
  quantity: number;
  price: number;
  status: string;
}

export interface PartUpdate {
  status?: string;
  po_no?: string;
  updated_at?: string;
}

// Visit types
export interface VisitRow {
  id: string;
  ticket_id: string;
  visit_date: string;
  technician_id: string;
  time_slot: string;
  status: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface VisitInsert {
  ticket_id: string;
  visit_date: string;
  technician_id: string;
  time_slot: string;
  status: string;
  notes?: string;
}

export interface VisitUpdate {
  status?: string;
  notes?: string;
  updated_at?: string;
}

// Employee types
export interface EmployeeRow {
  id: string;
  company_id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EmployeeInsert {
  company_id: string;
  email: string;
  name: string;
  role: string;
  is_active?: boolean;
}

export interface EmployeeUpdate {
  name?: string;
  role?: string;
  is_active?: boolean;
  updated_at?: string;
}

// Helper functions to check if Supabase is ready
export function isSupabaseConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return Boolean(url && key);
}

export function getSupabaseStatus(): string {
  if (isSupabaseConfigured()) {
    return "✅ Supabase configured (using mock until ready)";
  }
  return "⚠️ Supabase not configured (using mock)";
}
