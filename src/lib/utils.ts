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
