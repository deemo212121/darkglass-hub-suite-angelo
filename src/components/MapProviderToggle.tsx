/**
 * Controlled Google Maps / Leaflet segmented toggle. The caller owns the
 * actual company-setting state (via @/lib/supabase/companySettings) so
 * every place this renders — the Admin page, Ticket Map, etc. — reflects
 * and can change the same single source of truth.
 */
import type { MapProvider } from "@/lib/supabase/companySettings";

export function MapProviderToggle({
  value,
  onChange,
  disabled,
  className = "",
}: {
  value: MapProvider;
  onChange: (next: MapProvider) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={`inline-flex items-center gap-2 rounded-lg border border-white/15 bg-slate-900/60 p-1 ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("google")}
        className={`px-3 py-1.5 rounded text-xs font-semibold transition disabled:opacity-50 ${
          value === "google" ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-white/10"
        }`}
      >
        Google Maps
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("leaflet")}
        className={`px-3 py-1.5 rounded text-xs font-semibold transition disabled:opacity-50 ${
          value === "leaflet" ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-white/10"
        }`}
      >
        Leaflet (OSM)
      </button>
    </div>
  );
}
