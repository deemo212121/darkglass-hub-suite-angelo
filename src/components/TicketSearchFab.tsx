import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, MapPin } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TICKET_SEARCH_INDEX, normalizeTicketSearchValue } from "@/lib/ticket-search";
import { lookupZip } from "@/lib/zipCoverage";

export function TicketSearchFab() {
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [zipOpen, setZipOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [zipText, setZipText] = useState("");
  const [zipResult, setZipResult] = useState<ReturnType<typeof lookupZip>>(null);
  const [zipSearched, setZipSearched] = useState(false);

  const searchResults = useMemo(() => {
    const query = normalizeTicketSearchValue(searchText);
    if (!query) return TICKET_SEARCH_INDEX.slice(0, 8);
    return TICKET_SEARCH_INDEX.filter((entry) =>
      [entry.ticketNo, entry.customer, entry.city, entry.zip, entry.status].some((value) =>
        normalizeTicketSearchValue(value).includes(query),
      ),
    ).slice(0, 8);
  }, [searchText]);

  const openTicket = (ticketNo: string) => {
    setSearchOpen(false);
    setSearchText("");
    window.open(`/ticket/${encodeURIComponent(ticketNo)}`, "_blank", "noopener,noreferrer");
  };

  const handleSubmit = () => {
    const firstMatch = searchResults[0];
    if (firstMatch) { openTicket(firstMatch.ticketNo); return; }
    const exactTicketNo = searchText.trim();
    if (exactTicketNo) openTicket(exactTicketNo);
  };

  const handleZipLookup = () => {
    const result = lookupZip(zipText);
    setZipResult(result);
    setZipSearched(true);
  };

  useEffect(() => { if (!searchOpen) setSearchText(""); }, [searchOpen]);
  useEffect(() => { if (!zipOpen) { setZipText(""); setZipResult(null); setZipSearched(false); } }, [zipOpen]);

  return (
    <>
      {/* Ticket search button */}
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="fixed bottom-16 right-5 z-50 inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--color-panel-border)] bg-[oklch(0.18_0.04_260/0.9)] text-foreground shadow-[0_12px_30px_rgba(0,0,0,0.28)] backdrop-blur-md transition-transform hover:scale-105 hover:bg-[oklch(0.22_0.04_260/0.95)] focus:outline-none"
        aria-label="Search tickets"
      >
        <Search className="h-4 w-4 text-white" />
      </button>

      {/* Zip code lookup button */}
      <button
        type="button"
        onClick={() => setZipOpen(true)}
        className="fixed bottom-5 right-5 z-50 inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--color-panel-border)] bg-[oklch(0.18_0.04_260/0.9)] text-foreground shadow-[0_12px_30px_rgba(0,0,0,0.28)] backdrop-blur-md transition-transform hover:scale-105 hover:bg-[oklch(0.22_0.04_260/0.95)] focus:outline-none"
        aria-label="Zip code lookup"
      >
        <MapPin className="h-4 w-4 text-white" />
      </button>

      {/* Ticket search dialog */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="sm:max-w-sm border border-[var(--color-panel-border)] bg-[oklch(0.18_0.03_260/0.98)] text-foreground">
          <DialogHeader className="text-left">
            <DialogTitle className="font-display text-lg">Search ticket</DialogTitle>
            <DialogDescription>Type a ticket number, customer name, zip code, or status.</DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
            <label className="block space-y-2 text-sm">
              <span className="text-muted-foreground">Ticket search</span>
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Enter ticket number, zip code, name..."
                className="glass-input w-full"
                autoFocus
              />
            </label>
            {searchResults.length > 0 && searchText && (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {searchResults.map((entry) => (
                  <button
                    key={entry.ticketNo}
                    type="button"
                    onClick={() => openTicket(entry.ticketNo)}
                    className="w-full text-left px-3 py-2 rounded-md hover:bg-white/10 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-blue-400">{entry.ticketNo}</span>
                      <span className="text-xs text-muted-foreground truncate">{entry.status}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{entry.customer} — {entry.city} {entry.zip}</div>
                  </button>
                ))}
              </div>
            )}
            <input type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
          </form>
        </DialogContent>
      </Dialog>

      {/* Zip code lookup dialog */}
      <Dialog open={zipOpen} onOpenChange={setZipOpen}>
        <DialogContent className="sm:max-w-sm border border-[var(--color-panel-border)] bg-[oklch(0.18_0.03_260/0.98)] text-foreground">
          <DialogHeader className="text-left">
            <DialogTitle className="font-display text-lg flex items-center gap-2">
              <MapPin className="h-4 w-4 text-blue-400" /> Zip Code Lookup
            </DialogTitle>
            <DialogDescription>Enter a zip code to find the serving branch, city, and tier.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                value={zipText}
                onChange={(e) => { setZipText(e.target.value); setZipSearched(false); }}
                onKeyDown={(e) => e.key === "Enter" && handleZipLookup()}
                placeholder="e.g. 30002"
                className="glass-input flex-1"
                maxLength={5}
                autoFocus
              />
              <button
                type="button"
                onClick={handleZipLookup}
                className="px-4 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
              >
                Lookup
              </button>
            </div>

            {zipSearched && zipResult && (
              <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 space-y-2">
                <div className="flex items-center gap-2 text-green-300 font-semibold text-sm">
                  <MapPin className="h-4 w-4" /> Coverage Found
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Branch / Location</p>
                    <p className="font-semibold text-white">{zipResult.location}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">City</p>
                    <p className="font-semibold text-white">{zipResult.city}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Self-Schedule</p>
                    <p className="font-semibold text-white">{zipResult.selfSchedule === "3" ? "Yes" : zipResult.selfSchedule || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Tier Code</p>
                    <p className="font-semibold text-white">{zipResult.tierCode || "—"}</p>
                  </div>
                </div>
              </div>
            )}

            {zipSearched && !zipResult && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
                <p className="font-semibold">Zip code not found</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Zip code <span className="font-mono text-red-300">{zipText}</span> is not in our service coverage area.
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
