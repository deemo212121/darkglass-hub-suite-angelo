import { useEffect, useState } from "react";

// "Use desktop site" override — set from the mobile app's Desktop Site button.
// When set, a phone user is NOT auto-routed into the mobile experience.
const DESKTOP_OVERRIDE_KEY = "ahs:forceDesktop";
// Sticky "this is a phone, stay in the mobile app" flag. Once we decide a user
// is on a phone we remember it so a flaky reload (Brave randomizes UA / screen
// metrics with fingerprint protection on) doesn't bounce them to the web view.
const MOBILE_MODE_KEY = "ahs:mobileMode";

/**
 * Best-effort phone detection. Combines several independent signals so one
 * flaky/spoofed value (Brave fingerprint protection) doesn't flip the result:
 *  - navigator.userAgentData.mobile (Client Hints — most reliable, hard to fake)
 *  - mobile user-agent string
 *  - coarse pointer + touch capability
 *  - narrow viewport / screen
 * Tablets (incl. iPad) are intentionally treated as desktop.
 */
export function isPhoneDevice(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";

  // Tablets stay on desktop. iPadOS reports as "Macintosh" but is touch-capable.
  const isIPad =
    /iPad/i.test(ua) ||
    (/Macintosh/i.test(ua) && (navigator as any).maxTouchPoints > 1);
  if (isIPad) return false;
  if (/Tablet|PlayBook|Silk/i.test(ua)) return false;

  // 1. Client Hints (Chromium/Brave). When available this is authoritative.
  const uaData = (navigator as any).userAgentData;
  if (uaData && typeof uaData.mobile === "boolean") {
    // Android tablets also set mobile=false; phones set mobile=true.
    if (uaData.mobile) return true;
    // mobile=false but a phone UA + tiny screen can still be a phone in some
    // privacy modes — fall through to the heuristic instead of returning false.
  }

  // 2. UA string heuristic.
  const isAndroidPhone = /Android/i.test(ua) && /Mobile/i.test(ua);
  const isOtherPhone = /iPhone|iPod|Windows Phone|BlackBerry|BB10|IEMobile|Opera Mini/i.test(ua);
  const phoneUA = isAndroidPhone || isOtherPhone;

  // 3. Touch + coarse pointer (real phones; desktops are fine/mouse).
  const coarse =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const touch = (navigator as any).maxTouchPoints > 0 || "ontouchstart" in window;

  // 4. Narrow screen. Use the smaller of innerWidth and screen.width so a
  // desktop window resized narrow doesn't count unless it also looks touch.
  const vw = Math.min(
    window.innerWidth || 9999,
    (window.screen && window.screen.width) || 9999
  );
  const narrow = vw <= 820;

  // Decide: a phone UA is strong on its own; otherwise require touch + coarse +
  // narrow together (covers phones whose UA is spoofed to look desktop-ish).
  if (phoneUA) return true;
  return coarse && touch && narrow;
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
    if (on) {
      localStorage.setItem(DESKTOP_OVERRIDE_KEY, "1");
      // Leaving mobile on purpose — drop the sticky phone flag too.
      localStorage.removeItem(MOBILE_MODE_KEY);
    } else {
      localStorage.removeItem(DESKTOP_OVERRIDE_KEY);
    }
  } catch {
    /* ignore */
  }
}

/** Remember that this device/session should use the mobile app. */
export function setMobileMode(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) localStorage.setItem(MOBILE_MODE_KEY, "1");
    else localStorage.removeItem(MOBILE_MODE_KEY);
  } catch {
    /* ignore */
  }
}

export function isMobileModeSticky(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(MOBILE_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Whether the user should be routed into the mobile experience.
 * True when: not explicitly on desktop override, AND (we've already decided
 * this is mobile in a previous load OR the device looks like a phone now).
 * The sticky flag makes the decision stable across reloads even if a single
 * detection read is flaky.
 */
export function shouldUseMobile(): boolean {
  if (isDesktopOverride()) return false;
  if (isMobileModeSticky()) return true;
  return isPhoneDevice();
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
