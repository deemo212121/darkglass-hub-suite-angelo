import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { normalizeTicketSearchValue } from "@/lib/ticket-search";
import { getCompanyTickets } from "@/lib/supabase/tickets";
import type { Ticket } from "@/lib/ticketData";

export function TicketSearchFab() {
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);

  // Load real company tickets from Supabase when the search dialog opens.
  useEffect(() => {
    if (!searchOpen) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const rows = await getCompanyTickets();
        if (!cancelled) setTickets(rows);
      } catch (err) {
        console.error("Ticket search: failed to load tickets", err);
        if (!cancelled) setTickets([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchOpen]);

  const searchResults = useMemo(() => {
    const query = normalizeTicketSearchValue(searchText);
    if (!query) return tickets.slice(0, 8);
    return tickets.filter((ticket) =>
      [
        ticket.ticketNo,
        ticket.customer,
        ticket.city,
        ticket.zip || "",
        ticket.phone || "",
        ticket.model || "",
        ticket.location || "",
        ticket.technician || "",
        ticket.status,
      ].some((value) => normalizeTicketSearchValue(value).includes(query)),
    ).slice(0, 8);
  }, [searchText, tickets]);

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

  useEffect(() => { if (!searchOpen) setSearchText(""); }, [searchOpen]);

  return (
    <>
      {/* Ticket search button */}
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="fixed bottom-16 right-5 z-50 inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--color-panel-border)] bg-[var(--color-card)] text-foreground shadow-[0_12px_30px_rgba(0,0,0,0.28)] backdrop-blur-md transition-transform hover:scale-105 hover:bg-[var(--color-secondary)] focus:outline-none"
        aria-label="Search tickets"
      >
        <Search className="h-5 w-5" />
      </button>

      {/* Ticket search dialog */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="sm:max-w-sm border border-[var(--color-panel-border)] bg-[var(--color-card)] text-foreground">
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
            {loading && (
              <div className="text-xs text-muted-foreground px-1 py-2">Loading tickets…</div>
            )}
            {!loading && searchText && searchResults.length === 0 && (
              <div className="text-xs text-muted-foreground px-1 py-2">No matching tickets found.</div>
            )}
            {searchResults.length > 0 && searchText && (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {searchResults.map((ticket) => (
                  <button
                    key={ticket.ticketNo}
                    type="button"
                    onClick={() => openTicket(ticket.ticketNo)}
                    className="w-full text-left px-3 py-2 rounded-md hover:bg-white/10 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-blue-400">{ticket.ticketNo}</span>
                      <span className="text-xs text-muted-foreground truncate">{ticket.status}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{ticket.customer} — {ticket.city} {ticket.zip || ""}</div>
                  </button>
                ))}
              </div>
            )}
            <input type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
