import * as React from "react";
import { Navigate } from "@tanstack/react-router";

/**
 * @tanstack/react-router's <Navigate> decides whether to (re-)fire
 * navigate() by comparing its entire props object by reference
 * (`previousPropsRef.current !== props` in its own useLayoutEffect). JSX
 * like `<Navigate to="/home" replace />` builds a brand-new props object on
 * every render, so any re-render of the component returning it re-fires
 * navigate() — and since navigate() itself changes router state (another
 * re-render), a redirect condition that never resolves (e.g. a role gate
 * that stays denied) spins forever, throwing "Maximum update depth
 * exceeded". A condition that only takes a render or two to settle (e.g.
 * auth hydrating on first load) still re-fires navigate() an extra time
 * during mount, which is the source of React's "Can't perform a state
 * update on a component that hasn't mounted yet" warning.
 *
 * React.memo's shallow prop comparison bails out of re-invoking Navigate
 * (and thus rebuilding its props object) when `to`/`replace`/etc. haven't
 * actually changed, so navigate() fires exactly once per distinct target.
 * Use this instead of importing Navigate directly for any render-time
 * conditional redirect (`return <StableNavigate to="..." replace />`).
 */
export const StableNavigate = React.memo(Navigate);
