import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * A random id for client-side use (React keys, upload folder names, slug
 * suffixes, etc.) — never a real primary key. crypto.randomUUID() only
 * exists in secure contexts (https, or localhost); this app is also used
 * over plain http on a bare LAN IP (e.g. http://192.168.x.x:8080), where
 * `crypto.randomUUID` is simply undefined and throws "is not a function"
 * if called directly. Falls back to a timestamp + random-hex id there.
 */
export function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * A real v4 UUID, for an id that becomes a uuid primary key (randomId()'s
 * fallback isn't one). Works over plain http too: crypto.getRandomValues,
 * unlike crypto.randomUUID, isn't limited to secure contexts.
 */
export function randomUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
