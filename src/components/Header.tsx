import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import logo from "@/assets/logo.png";
import { Search, ChevronDown, Clock, LogOut, Settings as SettingsIcon, Shield, User } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TICKET_SEARCH_INDEX, normalizeTicketSearchValue } from "@/lib/ticket-search";

function getInitials(value: string | null) {
  if (!value) return "U";
  const localPart = value.split("@")[0] ?? value;
  const parts = localPart.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return localPart.slice(0, 2).toUpperCase();
}

export function AppHeader() {
  const { email, companyId, logout, ready } = useAuth();
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
    navigate({ to: `/ticket/${ticketNo}` });
  };

  const handleSubmit = () => {
    const firstMatch = searchResults[0];
    if (firstMatch) openTicket(firstMatch.ticketNo);
  };

  useEffect(() => {
    if (!searchOpen) setSearchText("");
  }, [searchOpen]);

  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-[oklch(0.16_0.04_260/0.7)] border-b border-[var(--color-panel-border)]">
      <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center gap-4">
        <Link to="/home" className="flex items-center gap-3">
          <img src={logo} alt="Admin Hub Solutions" className="h-9 w-9 object-contain" />
          <div>
            <div className="font-display font-semibold tracking-tight leading-none">Admin Hub Solutions</div>
            <div className="text-xs text-muted-foreground">Operations console</div>
          </div>
        </Link>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-panel-border)] bg-[oklch(0.98_0.005_250/0.05)] hover:bg-[oklch(0.98_0.005_250/0.1)] transition-colors"
            aria-label="Search tickets"
          >
            <Search className="h-4 w-4 text-muted-foreground" />
          </button>
          {ready && email && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="group flex items-center gap-2.5 rounded-full pl-1 pr-3 py-1 border border-[var(--color-panel-border)] bg-[oklch(0.98_0.005_250/0.05)] hover:bg-[oklch(0.98_0.005_250/0.1)] transition-colors cursor-pointer"
                  aria-label="Account menu"
                >
                  <span className="grid place-items-center h-8 w-8 rounded-full bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold">
                    {getInitials(email)}
                  </span>
                  <span className="hidden sm:flex flex-col items-start leading-tight">
                    <span className="text-foreground text-sm truncate max-w-[180px]">{email}</span>
                    <span className="text-muted-foreground text-[11px]">Company {companyId}</span>
                  </span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground group-data-[state=open]:rotate-180 transition-transform" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                sideOffset={8}
                className="z-[100] w-64 p-1.5 rounded-xl border border-[var(--color-panel-border)] bg-[oklch(0.20_0.04_260/0.98)] backdrop-blur-xl shadow-2xl"
              >
                <DropdownMenuLabel className="px-2 py-2">
                  <div className="flex items-center gap-2.5">
                    <span className="grid place-items-center h-9 w-9 rounded-full bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold">
                      {getInitials(email)}
                    </span>
                    <div className="leading-tight min-w-0">
                      <div className="text-sm font-medium truncate">{email}</div>
                      <div className="text-[11px] text-muted-foreground font-normal">Company {companyId}</div>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-[var(--color-panel-border)]" />
                <DropdownMenuItem onSelect={() => navigate({ to: "/profile" })} className="gap-2.5 px-2 py-2 rounded-lg cursor-pointer">
                  <User className="h-4 w-4 text-muted-foreground" /> My Profile
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate({ to: "/timecard" })} className="gap-2.5 px-2 py-2 rounded-lg cursor-pointer">
                  <Clock className="h-4 w-4 text-muted-foreground" /> My Timecard
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })} className="gap-2.5 px-2 py-2 rounded-lg cursor-pointer">
                  <SettingsIcon className="h-4 w-4 text-muted-foreground" /> Settings
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate({ to: "/privacy" })} className="gap-2.5 px-2 py-2 rounded-lg cursor-pointer">
                  <Shield className="h-4 w-4 text-muted-foreground" /> Privacy
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-[var(--color-panel-border)]" />
                <DropdownMenuItem
                  onSelect={() => {
                    logout();
                    navigate({ to: "/landing" });
                  }}
                  className="gap-2.5 px-2 py-2 rounded-lg cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="h-4 w-4" /> Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="sm:max-w-xl border border-[var(--color-panel-border)] bg-[oklch(0.18_0.03_260/0.98)] text-foreground">
          <DialogHeader className="text-left">
            <DialogTitle className="font-display text-xl">Search ticket</DialogTitle>
            <DialogDescription>Search by ticket number or zip code. Press Enter or click View.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="Ticket number or zip code"
              className="glass-input w-full"
              autoFocus
            />
            <div className="max-h-80 overflow-auto rounded-xl border border-[var(--color-panel-border)]">
              {searchResults.length > 0 ? (
                <div className="divide-y divide-[var(--color-panel-border)]">
                  {searchResults.map((result) => (
                    <div key={result.ticketNo} className="flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-sm text-white">{result.ticketNo}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {result.customer} • {result.city}{result.zip ? ` • ${result.zip}` : ""} • {result.status}
                        </div>
                      </div>
                      <button type="button" onClick={() => openTicket(result.ticketNo)} className="btn btn-primary text-xs px-3 py-2">
                        View
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-8 text-sm text-muted-foreground text-center">No tickets match that search.</div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
