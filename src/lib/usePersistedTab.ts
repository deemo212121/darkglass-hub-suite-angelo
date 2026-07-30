import { useEffect, useState } from "react";

/**
 * Like useState for a page's active tab, but remembers the last value in
 * localStorage under `storageKey` so a full page reload lands back on the
 * same tab instead of resetting to `defaultValue`. Falls back to
 * `defaultValue` if nothing is stored yet or the stored value isn't one of
 * `validValues` (e.g. a tab that no longer exists after a code change).
 *
 * Pass a storage key that already includes any per-entity id (ticket
 * number, user id, ...) for pages scoped to one record - the hook re-reads
 * from storage whenever `storageKey` itself changes, so it also does the
 * right thing if the same page instance navigates from one record to
 * another without unmounting.
 */
export function usePersistedTab<T extends string>(
  storageKey: string,
  validValues: readonly T[],
  defaultValue: T,
): [T, (value: T) => void] {
  const readStored = (): T => {
    if (typeof window === "undefined") return defaultValue;
    const raw = window.localStorage.getItem(storageKey);
    return raw && (validValues as readonly string[]).includes(raw) ? (raw as T) : defaultValue;
  };

  const [tab, setTabState] = useState<T>(readStored);

  useEffect(() => {
    setTabState(readStored());
    // Only the key identifies which record's tab to load - validValues/
    // defaultValue are static per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const setTab = (value: T) => {
    setTabState(value);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, value);
    }
  };

  return [tab, setTab];
}
