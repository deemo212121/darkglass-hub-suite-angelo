import { useEffect, useState } from "react";

// Key for the "use desktop site" override. When set, a phone user is NOT
// auto-redirected into the mobile experience (the "Desktop Sign In" escape).
const DESKTOP_OVERRIDE_KEY = "ahs:forceDesktop";

/**
 * Detect a phone-class device. Tablets (incl. iPad) intentionally stay on the
 * desktop layout. We combine a narrow-viewport check with a mobile user-agent
 * check so a small laptop window doesn't masquerade as a phone.
 */
export function isPhoneDevice(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPadOS reports as "Macintosh" but has touch — treat any iPad as tablet.
  const isIPad =
    /iPad/i.test(ua) ||
    (/Macintosh/i.test(ua) && typeof navigator !== "undefined" && (navigator as any).maxTouchPoints > 1);
  if (isIPad) return false;
  // Explicit tablet keywords stay on desktop.
  if (/Tablet|PlayBook|Silk/i.test(ua)) return false;
  // Android tablets omit "Mobile" in the UA; phones include it.
  const isAndroidPhone = /Android/i.test(ua) && /Mobile/i.test(ua);
  const isOtherPhone = /iPhone|iPod|Windows Phone|BlackBerry|BB10|IEMobile|Opera Mini/i.test(ua);
  const phoneUA = isAndroidPhone || isOtherPhone;
  const narrow = window.matchMedia("(max-width: 820px)").matches;
  // Require both a phone UA and a narrow viewport to avoid false positives.
  return phoneUA && narrow;
}

export function isDesktopOverride(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(DESKTOP_OVERRIDE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDesktopOverride(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) localStorage.setItem(DESKTOP_OVERRIDE_KEY, "1");
    else localStorage.removeItem(DESKTOP_OVERRIDE_KEY);
  } catch {
    /* ignore */
  }
}

/** Reactively report whether the current device is a phone. */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState<boolean>(() => isPhoneDevice());
  useEffect(() => {
    const update = () => setPhone(isPhoneDevice());
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  return phone;
}

/**
 * Whether the technician/role should be routed into the mobile experience.
 * Phone device AND no desktop override.
 */
export function shouldUseMobile(): boolean {
  return isPhoneDevice() && !isDesktopOverride();
}
