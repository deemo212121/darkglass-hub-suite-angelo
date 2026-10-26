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
// One-active-session-per-account (migration 0124) — whatever /api/supabase-token
// last reported as this account's current_session_id. auth.tsx compares this
// against what it locally claimed to detect a login elsewhere superseding
// this device. See supabaseTokenBridge.ts's mintOrReadSessionId.
let currentSessionId: string | null = null;
// The signed-in Firebase user the token belongs to, so a request can mint a
// fresh token itself when the stored one is missing or about to expire —
// e.g. the background / app-resume refresh failed on a flaky phone
// connection. Without it the request went out with no login at all and RLS
// refused it ("new row violates row-level security policy" on a Time Out,
// Chris Simpson 2026-10-26) until the next refresh 45 minutes later.
let tokenUser: FirebaseUser | null = null;
let refreshInFlight: Promise<boolean> | null = null;
// After a failed exchange, requests wait this long before trying again, so
// a page full of requests on no signal doesn't each sit through one.
const REQUEST_REFRESH_RETRY_MS = 10_000;
let lastRequestRefreshFailedAt = 0;

/** Missing, or expiring within a minute. */
function tokenNeedsRefresh(): boolean {
  return !supabaseAccessToken || tokenExpiresAt - Math.floor(Date.now() / 1000) < 60;
}

/** Before a request: mint a token first if there's a signed-in user but no usable token (one exchange at a time). */
async function ensureTokenBeforeRequest(): Promise<void> {
  if (!tokenUser || !tokenNeedsRefresh()) return;
  if (!refreshInFlight) {
    if (Date.now() - lastRequestRefreshFailedAt < REQUEST_REFRESH_RETRY_MS) return;
    refreshInFlight = refreshSupabaseSession(tokenUser)
      .then((ok) => {
        if (!ok) lastRequestRefreshFailedAt = Date.now();
        return ok;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  await refreshInFlight.catch(() => false);
}

const READ_TIMEOUT_MS = 60_000;
const READ_RETRY_TIMEOUT_MS = 90_000;
const READ_TIMEOUT_ERROR = "SupabaseReadTimeout";

/** fetch that gives up after `ms`, still honouring the caller's own abort signal. */
function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, ms);
  const callerSignal = init.signal;
  const onCallerAbort = () => ctl.abort();
  if (callerSignal) {
    if (callerSignal.aborted) ctl.abort();
    else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  }
  // The body is read inside the time limit too — a stall can just as well
  // happen mid-download, after the headers have already arrived.
  return fetch(input, { ...init, signal: ctl.signal })
    .then(async (res) => {
      const body = await res.arrayBuffer();
      const nullBody = res.status === 204 || res.status === 205 || res.status === 304;
      return new Response(nullBody ? null : body, { status: res.status, statusText: res.statusText, headers: res.headers });
    })
    .catch((err) => {
      if (timedOut) {
        const e = new Error(`Request timed out after ${ms / 1000}s`);
        e.name = READ_TIMEOUT_ERROR;
        throw e;
      }
      throw err;
    })
    .finally(() => {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    });
}

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
      fetch: async (input, init = {}) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        // Never send a data / storage request without the login when one can
        // be had — see tokenUser above.
        if (url.includes("/rest/v1/") || url.includes("/storage/v1/")) await ensureTokenBeforeRequest();
        const headers = new Headers(init.headers);
        if (supabaseAccessToken) {
          headers.set("Authorization", `Bearer ${supabaseAccessToken}`);
        }
        const method = (init.method || "GET").toUpperCase();
        // Reads only (never writes or storage uploads): a request that
        // stalls on a flaky connection never settles on its own, which
        // left whole pages (Attendance Monitoring, Trainee Attendance)
        // stuck on "Loading…" for good. Give each read a time limit and
        // one retry instead.
        if ((method === "GET" || method === "HEAD") && url.includes("/rest/v1/")) {
          return fetchWithTimeout(input, { ...init, headers }, READ_TIMEOUT_MS).catch((err) => {
            if (err?.name !== READ_TIMEOUT_ERROR) throw err;
            console.warn("Supabase read timed out — retrying once:", url.split("?")[0]);
            return fetchWithTimeout(input, { ...init, headers }, READ_RETRY_TIMEOUT_MS);
          });
        }
        return fetch(input, { ...init, headers });
      },
    },
  }
);

/**
 * Exchange the current Firebase user's ID token for a Supabase JWT and store it.
 * Call this right after login and whenever the token is near expiry.
 *
 * `recordLogin` tells the server to log this exchange to login_events (IP,
 * geolocation, browser/device) — only true for the one exchange that
 * follows an actual interactive sign-in (see auth.tsx's
 * pendingInteractiveLoginRef), not the 45-min background refresh, the
 * tab-focus refresh, or a persisted-session restore on page load. Keeps
 * the login-history table from growing on every routine token refresh.
 */
export async function refreshSupabaseSession(
  firebaseUser: FirebaseUser | null,
  opts?: { recordLogin?: boolean }
): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    console.warn("⚠️ Supabase not configured (.env). Skipping token exchange.");
    return false;
  }
  if (!firebaseUser) {
    clearSupabaseSession();
    return false;
  }
  tokenUser = firebaseUser;

  // A failed exchange keeps the token already held while it's still valid
  // (it used to be thrown away). The server answers 401 for any failure,
  // including passing ones — a slow database, a key fetch — so one bad
  // refresh on a weak signal no longer leaves every request until the next
  // refresh going out with no login (refused by RLS). Requests retry the
  // exchange themselves while the token is missing (ensureTokenBeforeRequest).
  const keepTokenIfValid = () => {
    if (tokenExpiresAt <= Math.floor(Date.now() / 1000)) {
      supabaseAccessToken = null;
      tokenExpiresAt = 0;
    }
  };

  try {
    const idToken = await firebaseUser.getIdToken(/* forceRefresh */ false);
    const res = await fetch("/api/supabase-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, recordLogin: !!opts?.recordLogin }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("❌ Supabase token exchange failed:", err);
      keepTokenIfValid();
      return false;
    }

    const { token, expiresAt, sessionId } = (await res.json()) as { token: string; expiresAt: number; sessionId?: string | null };
    supabaseAccessToken = token;
    tokenExpiresAt = expiresAt;
    if (sessionId) currentSessionId = sessionId;
    if (import.meta.env.DEV) console.log("✅ Supabase session established (expires", new Date(expiresAt * 1000).toLocaleTimeString(), ")");
    return true;
  } catch (error) {
    console.error("❌ Error exchanging Firebase token for Supabase token:", error);
    keepTokenIfValid();
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

/** Sign-out: drop the token and the user it belongs to (requests stop minting new ones). */
export function clearSupabaseSession(): void {
  supabaseAccessToken = null;
  tokenExpiresAt = 0;
  currentSessionId = null;
  tokenUser = null;
}

export function hasSupabaseSession(): boolean {
  return Boolean(supabaseAccessToken);
}

/** Whatever /api/supabase-token last reported as this account's current_session_id — see the module comment above. */
export function getCurrentSessionId(): string | null {
  return currentSessionId;
}
