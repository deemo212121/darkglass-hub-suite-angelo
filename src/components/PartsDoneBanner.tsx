/**
 * Yellow reminder on the Parts pages while parts are marked done but the
 * Done update hasn't been sent to the Parts Manager yet (see
 * PartsDoneButton). Lists each part and what was done to it; "Done" opens
 * the Done box.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCheck } from "lucide-react";
import { getPendingDoneItems, PARTS_DONE_QUEUE_EVENT, type PendingDoneItem } from "@/lib/partsDoneQueue";
import { OPEN_PARTS_DONE_EVENT } from "@/components/PartsDoneButton";

/** What each page's "done" means, by the page that recorded it. */
const ACTION_BY_SOURCE: Record<string, string> = {
  "Part Receive": "Received",
  "Part Daily Pickup": "Picked up",
  "Part Daily Collection": "Collected",
};

const SHOW_AT_MOST = 8;

export function PartsDoneBanner() {
  const [items, setItems] = useState<PendingDoneItem[]>([]);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    const refresh = () => setItems(getPendingDoneItems());
    refresh();
    window.addEventListener(PARTS_DONE_QUEUE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(PARTS_DONE_QUEUE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  if (items.length === 0) return null;

  const shown = showAll ? items : items.slice(0, SHOW_AT_MOST);
  return (
    <div className="mb-4 rounded-lg border border-amber-400/50 bg-amber-400/15 px-4 py-3 text-sm text-amber-100">
      <div className="flex flex-wrap items-center gap-3">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
        <span className="flex-1 min-w-[220px]">
          <strong>
            {items.length} part{items.length === 1 ? "" : "s"} updated.
          </strong>{" "}
          Please click <strong>DONE</strong> to complete this action.
        </span>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_PARTS_DONE_EVENT))}
          className="btn btn-primary btn-sm"
        >
          <CheckCheck /> DONE
        </button>
      </div>
      <ul className="mt-2 space-y-1 pl-7">
        {shown.map((i) => (
          <li key={i.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-mono font-semibold text-white">{i.label}</span>
            <span className="rounded bg-emerald-500/20 px-1.5 py-px text-[11px] font-semibold text-emerald-200">{ACTION_BY_SOURCE[i.source] ?? i.source}</span>
            {i.branch && <span className="text-xs text-amber-200/80">{i.branch}</span>}
          </li>
        ))}
      </ul>
      {items.length > SHOW_AT_MOST && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-1 pl-7 text-xs text-amber-200 underline">
          {showAll ? "Show less" : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}
