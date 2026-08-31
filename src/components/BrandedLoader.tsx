import { useEffect, useState } from "react";
import logo from "@/assets/Admin Hub Solutions Logo no Text.png";

/**
 * Centered loading indicator that only appears once loading has taken a
 * noticeable amount of time — a fast load never shows it, so there's no
 * flash on the common case.
 */
export function BrandedLoader({ label = "Loading...", delayMs = 450 }: { label?: string; delayMs?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);

  if (!visible) return null;

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16">
      <img src={logo} alt="" className="h-12 w-12 motion-safe:animate-pulse" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
