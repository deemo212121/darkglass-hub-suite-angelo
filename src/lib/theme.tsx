/**
 * Theme context — lets any component flip the app between dark and light
 * by toggling a `data-theme="light"` attribute on <html>. Persisted to
 * localStorage so the choice survives reloads.
 *
 * Pulled from the upstream usapp repo to bring the light palette into
 * this codebase without restructuring how individual components style
 * themselves; the CSS in styles.css does the heavy lifting via
 * :root[data-theme="light"] overrides.
 */
import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
  /** "Low device" (top bar): drops the frosted-glass blur — heavy on slower PCs and phones. Off by default; kept per browser. */
  lowDevice: boolean;
  toggleLowDevice: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggleTheme: () => {},
  setTheme: () => {},
  lowDevice: false,
  toggleLowDevice: () => {},
});

const STORAGE_KEY = "ahs:theme";
const LOW_DEVICE_KEY = "ahs:low-device";

function applyLowDevice(on: boolean) {
  if (typeof document === "undefined") return;
  if (on) document.documentElement.setAttribute("data-low-device", "on");
  else document.documentElement.removeAttribute("data-low-device");
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [lowDevice, setLowDevice] = useState(false);

  // Load persisted preference on mount.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (saved === "light" || saved === "dark") {
        setThemeState(saved);
        applyTheme(saved);
      }
      if (localStorage.getItem(LOW_DEVICE_KEY) === "on") {
        setLowDevice(true);
        applyLowDevice(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    applyTheme(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* ignore */
    }
  };

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  const toggleLowDevice = () => {
    const next = !lowDevice;
    setLowDevice(next);
    applyLowDevice(next);
    try {
      if (next) localStorage.setItem(LOW_DEVICE_KEY, "on");
      else localStorage.removeItem(LOW_DEVICE_KEY);
    } catch {
      /* ignore */
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme, lowDevice, toggleLowDevice }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
