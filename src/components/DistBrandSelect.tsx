/**
 * Brand picker under Part Dist. on the ticket's Part Transaction — only for
 * Marcone and Encompass parts. One part number can exist under several
 * brands at the distributor (Marcone "make", Encompass "mfgCode"), each with
 * its own stock; the brands load the first time the dropdown is opened,
 * in-stock first. The value is saved on the part as "<Distributor>|<code>"
 * (parts.dist_brand, migration 0353) and Submit POs / Place Order orders
 * that brand. Empty = the distributor's first match, as before.
 */
import { useState } from "react";
import { isMarconeDist, isEncompassDist } from "@/lib/supabase/partOrders";

type BrandOption = { code: string; name?: string; totalAvailable: number };

export function DistBrandSelect({
  partNumber,
  partDist,
  value,
  onChange,
  disabled,
  className,
}: {
  partNumber: string;
  partDist: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const distributor = isMarconeDist(partDist) ? "Marcone" : isEncompassDist(partDist) ? "Encompass" : null;
  const [options, setOptions] = useState<BrandOption[] | null>(null);
  const [loadedFor, setLoadedFor] = useState("");
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!distributor) return null;

  const key = `${distributor}|${partNumber.trim().toUpperCase()}`;
  const load = async () => {
    if (!partNumber.trim() || loading || loadedFor === key) return;
    setLoading(true);
    setFailed(false);
    try {
      const list =
        distributor === "Marcone"
          ? await (await import("@/lib/marconeApi")).marconeLookupPartBrands(partNumber)
          : await (await import("@/lib/encompassApi")).encompassLookupPartBrands(partNumber);
      setOptions(list);
      setLoadedFor(key);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  // Saved value only counts for this distributor ("Marcone|GEH" on a Marcone part).
  const [savedDist, savedCode] = value.split("|");
  const current = savedDist === distributor && savedCode ? savedCode : "";
  const list = loadedFor === key ? options ?? [] : [];
  const label = (o: BrandOption) => `${o.code}${o.name ? ` · ${o.name}` : ""} — ${o.totalAvailable > 0 ? `${o.totalAvailable} in stock` : "out of stock"}`;

  return (
    <select
      value={current}
      onFocus={() => void load()}
      onMouseDown={() => void load()}
      onChange={(e) => onChange(e.target.value ? `${distributor}|${e.target.value}` : "")}
      disabled={disabled || !partNumber.trim()}
      title={!partNumber.trim() ? "Enter the part number first" : `Which ${distributor} brand to order — shows each brand's stock`}
      className={className}
    >
      <option value="">{loading ? "Loading brands…" : failed ? "Brand: couldn't load — first match" : "Brand: first match"}</option>
      {current && !list.some((o) => o.code === current) && <option value={current}>{current} (saved)</option>}
      {list.map((o) => (
        <option key={o.code} value={o.code}>
          {label(o)}
        </option>
      ))}
      {loadedFor === key && list.length === 0 && <option disabled>No brands found</option>}
    </select>
  );
}
