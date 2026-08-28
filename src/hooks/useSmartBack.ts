import { useRouter } from "@tanstack/react-router";

/**
 * A "Back" button that actually returns to wherever the user came from,
 * instead of always jumping to one fixed destination and silently
 * discarding it (e.g. a filtered ticket list, a scroll position, or
 * whatever page actually linked here). Falls back to `fallback` only when
 * there's no real in-app history to return to — a bookmarked or shared
 * link opened directly, where going back would otherwise leave the app.
 */
export function useSmartBack(fallback: () => void): () => void {
  const router = useRouter();
  return () => {
    if (router.history.canGoBack()) {
      router.history.back();
    } else {
      fallback();
    }
  };
}
