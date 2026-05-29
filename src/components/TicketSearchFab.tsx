import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TICKET_SEARCH_INDEX, normalizeTicketSearchValue } from "@/lib/ticket-search";

export function TicketSearchFab() {
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");

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
    if (firstMatch) {
      openTicket(firstMatch.ticketNo);
      return;
    }

    const exactTicketNo = searchText.trim();
    if (exactTicketNo) {
      openTicket(exactTicketNo);
    }
  };

  useEffect(() => {
    if (!searchOpen) setSearchText("");
  }, [searchOpen]);

  return (
    <>
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="fixed bottom-5 right-5 z-50 inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--color-panel-border)] bg-[oklch(0.18_0.04_260/0.9)] text-foreground shadow-[0_12px_30px_rgba(0,0,0,0.28)] backdrop-blur-md transition-transform hover:scale-105 hover:bg-[oklch(0.22_0.04_260/0.95)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2 focus:ring-offset-transparent"
        aria-label="Search tickets"
      >
        <Search className="h-4 w-4 text-white" />
      </button>

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="sm:max-w-sm border border-[var(--color-panel-border)] bg-[oklch(0.18_0.03_260/0.98)] text-foreground">
          <DialogHeader className="text-left">
            <DialogTitle className="font-display text-lg">Search ticket</DialogTitle>
            <DialogDescription>Type a ticket number or zip code, then press Enter.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            <label className="block space-y-2 text-sm">
              <span className="text-muted-foreground">Ticket search</span>
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Enter ticket number or zip code"
                className="glass-input w-full"
                autoFocus
              />
            </label>
            <input
              type="submit"
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
            />
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}