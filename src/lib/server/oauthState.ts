/**
 * The `state` value on Google's connect round trip (Gmail and Google Drive).
 * It says which company, slot and person a new connection belongs to, and it
 * travels through the browser, so anyone could send back one they made up. The
 * server signs it when the connection starts and only trusts it if the signature
 * checks out and it's under 15 minutes old. Without this, someone with their own
 * Google account and a company's id could swap that company's mailbox for theirs.
 */
import { b64urlToString, strToB64url } from "./supabaseTokenBridge";

const MAX_AGE_MS = 15 * 60 * 1000;
/** Clocks across servers can disagree slightly. */
const CLOCK_SKEW_MS = 60 * 1000;

const encoder = new TextEncoder();
const hmacKey = (secret: string, usage: "sign" | "verify") =>
  crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);

/** `purpose` keeps a state issued for one kind of connection from being accepted by another. */
export async function signOAuthState(secret: string, purpose: string, claims: Record<string, unknown>, now = Date.now()): Promise<string> {
  const body = strToB64url(JSON.stringify({ ...claims, iat: now }));
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(`${purpose}.${body}`));
  const sig = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${body}.${sig}`;
}

/** The claims, or null if the state was altered, made up, issued for something else, or is too old. */
export async function readOAuthState<T>(secret: string, purpose: string, state: string, now = Date.now()): Promise<T | null> {
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/.test(sig)) return null;
  const sigBytes = Uint8Array.from(sig.match(/../g)!, (hex) => parseInt(hex, 16));
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), sigBytes, encoder.encode(`${purpose}.${body}`));
  if (!valid) return null;
  const claims = JSON.parse(b64urlToString(body)) as T & { iat?: unknown };
  if (typeof claims.iat !== "number" || now - claims.iat > MAX_AGE_MS || claims.iat - now > CLOCK_SKEW_MS) return null;
  return claims;
}

/**
 * The state's contents WITHOUT checking them. Only for picking which of our own
 * pages to return someone to after a failed or cancelled connect, so an expired
 * connect still lands where it started. Never use it to decide what to save.
 */
export function peekOAuthState(state: string | null): Record<string, unknown> | null {
  if (!state) return null;
  try {
    const dot = state.lastIndexOf(".");
    return JSON.parse(b64urlToString(dot > 0 ? state.slice(0, dot) : state));
  } catch {
    return null;
  }
}
