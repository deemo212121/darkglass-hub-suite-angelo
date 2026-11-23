import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * useState that remembers its value while this browser tab stays open:
 * leave a page and come back, and its search / dates / branch are still set.
 *
 * Kept in sessionStorage — only this tab, only this browser, gone when the
 * tab is closed — so a filter never sticks around for days, and nothing is
 * saved to the database. If storage is blocked (private window, previews),
 * it behaves like plain useState.
 *
 * Values must be plain JSON (strings, numbers, booleans) — not Sets / Maps.
 */
export function useRememberedState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const storageKey = `ahs:filters:${key}`;
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* storage blocked — still works, just isn't remembered */
    }
  }, [storageKey, value]);
  return [value, setValue];
}
