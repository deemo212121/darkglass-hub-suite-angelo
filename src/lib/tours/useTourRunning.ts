/** True while a guided tour is running (see runTour's TOUR_CHANGE_EVENT). */
import { useEffect, useState } from "react";
import { TOUR_CHANGE_EVENT, isTourRunning } from "./runTour";

export function useTourRunning(): boolean {
  const [running, setRunning] = useState(isTourRunning);
  useEffect(() => {
    const fn = (e: Event) => setRunning(Boolean((e as CustomEvent<{ running: boolean }>).detail?.running));
    window.addEventListener(TOUR_CHANGE_EVENT, fn);
    return () => window.removeEventListener(TOUR_CHANGE_EVENT, fn);
  }, []);
  return running;
}
