/** Pure (no browser/Supabase imports) so the server can use it too. */
/** "Mobile Safari (iPhone)", "Chrome (Windows)", "Samsung Internet (Android)"… */
export function describeDevice(ua: string = typeof navigator !== "undefined" ? navigator.userAgent : ""): string {
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : "Unknown device";
  const browser = /SamsungBrowser/.test(ua)
    ? "Samsung Internet"
    : /Edg\//.test(ua)
      ? "Edge"
      : /CriOS|Chrome\//.test(ua)
        ? "Chrome"
        : /FxiOS|Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? /Mobile/.test(ua) ? "Mobile Safari" : "Safari"
            : "Browser";
  return `${browser} (${os})`;
}
