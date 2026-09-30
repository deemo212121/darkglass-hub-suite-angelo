import { useRef } from "react";

/**
 * A render-time conditional redirect (`return <Navigate to="/home" replace />`)
 * that's still mounted when its own component re-renders for an unrelated
 * reason re-fires @tanstack/react-router's <Navigate>: it decides whether to
 * (re-)call navigate() by comparing its whole props object by reference
 * (`previousPropsRef.current !== props` in its own useLayoutEffect), and JSX
 * always builds a fresh props object per render, so every re-render re-fires
 * navigate() — which changes router state, which re-renders the caller,
 * which re-fires navigate() again. An unresolved condition (e.g. a role gate
 * that stays denied) spins forever ("Maximum update depth exceeded",
 * reproduced live); one that only takes a render or two to settle (auth
 * hydrating) still double-fires during mount, which is React's "state
 * update on a component that hasn't mounted yet" warning.
 *
 * The first attempt at a fix re-imported Navigate from a wrapper module
 * (React.memo'd, then a plain useNavigate()+useEffect replacement) instead
 * of straight from @tanstack/react-router. Both broke production: every
 * single request started throwing "TypeError: Cannot read properties of
 * undefined (reading 'extends')" from the router's own SSR route-tree/
 * dehydrate step. Bisected file-by-file to confirm it's specifically the
 * import source that matters — @tanstack/start's route file analysis
 * apparently needs `Navigate` imported directly (unaliased) from
 * "@tanstack/react-router" in a route file to build its route manifest
 * correctly. Whatever it's actually doing, don't fight it: keep the
 * `import { Navigate } from "@tanstack/react-router"` line exactly as-is in
 * every route file, and only guard how many times it's ALLOWED to be
 * rendered with fresh props instead.
 *
 * Call this once per component (before any early return) to get a guard
 * function, then wrap every `<Navigate to="..." replace />` at its call
 * site: `return redirectOnce("/home") ? <Navigate to="/home" replace /> : null;`
 * The first render for a given (to, replace) pair renders the real
 * <Navigate> once (which fires navigate() via its own effect, same as
 * before); every subsequent render of this component with the SAME target
 * renders null instead — no new <Navigate> props object, so no re-fired
 * navigate() call, so no loop — while a render with a DIFFERENT target
 * (e.g. the role gate result changes) still fires normally.
 */
export function useRedirectGuard(): (to: string, replace?: boolean) => boolean {
  const firedForRef = useRef<string | null>(null);
  return (to: string, replace = true) => {
    const key = `${to}|${replace ? 1 : 0}`;
    if (firedForRef.current === key) return false;
    firedForRef.current = key;
    return true;
  };
}
