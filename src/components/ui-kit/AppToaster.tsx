/**
 * The app's one toast host — mounted once in the root layout. Call
 * `toast.success("Saved")` / `toast.error("…")` from "sonner" anywhere.
 * Follows the light/dark theme; top-center on the mobile app (above the
 * bottom tab bar, under the thumb's way), bottom-right on desktop.
 */
import { Toaster } from "sonner";
import { useTheme } from "@/lib/theme";

export function AppToaster({ mobile }: { mobile: boolean }) {
  const { theme } = useTheme();
  return (
    <Toaster
      theme={theme}
      position={mobile ? "top-center" : "bottom-right"}
      richColors
      closeButton
      duration={3500}
      toastOptions={{ style: { fontSize: 13 } }}
    />
  );
}
