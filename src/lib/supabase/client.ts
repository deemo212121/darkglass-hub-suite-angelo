/**
 * Supabase client (browser).
 *
 * Auth model: login stays in Firebase. We exchange the Firebase ID token for a
 * Supabase JWT (via /api/supabase-token) and attach it to every Supabase request
 * so Postgres RLS scopes all data to the caller's company.
 *
 * Usage:
 *   import { supabase, refreshSupabaseSession, clearSupabaseSession } from "@/lib/supabase/client";
 *   await refreshSupabaseSession(firebaseUser);   // after login
 *   const { data } = await supabase.from("tickets").select("*");
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { User as FirebaseUser } from "firebase/auth";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// The minted Supabase JWT is held here and injected into every request.
let supabaseAccessToken: string | null = null;
let tokenExpiresAt = 0; // unix seconds

// Single shared client. We override the Authorization header per request via
// the global fetch wrapper so we always send the freshest minted token.
export const supabase: SupabaseClient = createClient(
  SUPABASE_URL ?? "http://localhost",
  SUPABASE_ANON_KEY ?? "public-anon-key",
  {
    auth: {
      persistSession: false,    // Firebase owns the session, not Supabase
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init = {}) => {
        const headers = new Headers(init.headers);
        if (supabaseAccessToken) {
          headers.set("Authorization", `Bearer ${supabaseAccessToken}`);
        }
        return fetch(input, { ...init, headers });
      },
    },
  }
);

/**
 * Exchange the current Firebase user's ID token for a Supabase JWT and store it.
 * Call this right after login and whenever the token is near expiry.
 */
export async function refreshSupabaseSession(firebaseUser: FirebaseUser | null): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    console.warn("⚠️ Supabase not configured (.env). Skipping token exchange.");
    return false;
  }
  if (!firebaseUser) {
    clearSupabaseSession();
    return false;
  }

  try {
    const idToken = await firebaseUser.getIdToken(/* forceRefresh */ false);
    const res = await fetch("/api/supabase-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("❌ Supabase token exchange failed:", err);
      clearSupabaseSession();
      return false;
    }

    const { token, expiresAt } = (await res.json()) as { token: string; expiresAt: number };
    supabaseAccessToken = token;
    tokenExpiresAt = expiresAt;
    console.log("✅ Supabase session established (expires", new Date(expiresAt * 1000).toLocaleTimeString(), ")");
    return true;
  } catch (error) {
    console.error("❌ Error exchanging Firebase token for Supabase token:", error);
    clearSupabaseSession();
    return false;
  }
}

/**
 * Ensure we have a valid (non-expired) Supabase token, refreshing if needed.
 * Call before making important queries if the session has been idle.
 */
export async function ensureSupabaseSession(firebaseUser: FirebaseUser | null): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  // refresh if missing or within 5 min of expiry
  if (!supabaseAccessToken || tokenExpiresAt - now < 300) {
    return refreshSupabaseSession(firebaseUser);
  }
  return true;
}

export function clearSupabaseSession(): void {
  supabaseAccessToken = null;
  tokenExpiresAt = 0;
}

export function hasSupabaseSession(): boolean {
  return Boolean(supabaseAccessToken);
}
