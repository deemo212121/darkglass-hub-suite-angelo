import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import logo from "@/assets/Admin Hub Solutions Logo no Text.png";
import { ChevronDown, Clock, LogOut, Settings as SettingsIcon, Shield, User, Sun, Moon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AnnouncementsMenu } from "@/components/AnnouncementsMenu";
import { MessagesMenu } from "@/components/MessagesMenu";
import { NotificationsMenu } from "@/components/NotificationsMenu";
import { TimeClockButtons } from "@/components/TimeClockMenu";
import { useTheme } from "@/lib/theme";

/**
 * Live Central Time clock in the header — this app's operations run across
 * many US timezones (see LOCATIONS in AdminUserManagementPage.tsx), so a
 * shared reference clock avoids "whose timezone is this timestamp in?"
 * confusion. Clock math uses America/Chicago (correct through DST changes);
 * the label is always "CST" per requested wording, not a dynamic CST/CDT switch.
 */
function CentralClock() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const update = () => {
      setTime(
        new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Chicago",
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        }).format(new Date())
      );
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!time) return null;

  return (
    <div
      className="hidden md:flex items-center gap-1.5 rounded-full border border-[var(--color-panel-border)] bg-[var(--color-panel)] px-3 py-1.5 text-xs text-muted-foreground"
      title="Central Time"
    >
      <Clock className="h-3.5 w-3.5" />
      <span className="font-mono tabular-nums">{time}</span>
      <span className="font-semibold">CST</span>
    </div>
  );
}

function getInitials(value: string | null) {
  if (!value) return "U";
  const localPart = value.split("@")[0] ?? value;
  const parts = localPart.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return localPart.slice(0, 2).toUpperCase();
}

function loadEmployeePhoto(email: string | null) {
  if (typeof window === "undefined" || !email) return "";
  const normalizedEmail = email.trim().toLowerCase();
  const keys = [
    `ahs:employee-info-email:${normalizedEmail}`,
    `ahs:employee-info:${normalizedEmail}`,
  ];

  for (const key of keys) {
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as { photoDataUrl?: string };
      if (typeof parsed.photoDataUrl === "string" && parsed.photoDataUrl) return parsed.photoDataUrl;
    } catch {
      continue;
    }
  }

  return "";
}

export function AppHeader() {
  const { email, companyId, companyLoginAlias, logout, ready } = useAuth();
  // Prefer the short login alias (e.g. "USAPP") over the raw legacy_code
  // ("COMP001") when one's set for this company; falls back to companyId
  // for the companies that don't have an alias configured yet.
  const companyDisplay = companyLoginAlias || companyId;
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [photoDataUrl, setPhotoDataUrl] = useState("");

  useEffect(() => {
    setPhotoDataUrl(loadEmployeePhoto(email));
  }, [email]);

  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-[var(--color-background)]/70 border-b border-[var(--color-panel-border)]">
      <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center gap-4">
        <Link to="/home" className="flex items-center gap-3">
          <img src={logo} alt="Admin Hub Solutions" className="logo-img h-9 w-9 object-contain" />
          <div>
            <div className="font-display font-semibold tracking-tight leading-none">Admin Hub Solutions</div>
            <div className="text-xs text-muted-foreground">Operations console</div>
          </div>
        </Link>
        <CentralClock />
        <div className="ml-auto flex items-center gap-2 text-sm">
          {ready && email && <TimeClockButtons />}
          {ready && email && (
            <button
              type="button"
              onClick={toggleTheme}
              className="grid h-9 w-9 place-items-center rounded-full border border-[var(--color-panel-border)] bg-[var(--color-panel)] text-muted-foreground transition-colors hover:bg-[var(--color-secondary)] hover:text-foreground"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          )}
          {ready && email && <AnnouncementsMenu />}
          {ready && email && <NotificationsMenu />}
          {ready && email && <MessagesMenu />}
          {ready && email && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="group flex items-center gap-2.5 rounded-full pl-1 pr-3 py-1 border border-[var(--color-panel-border)] bg-[var(--color-panel)] hover:bg-[var(--color-secondary)] transition-colors cursor-pointer"
                  aria-label="Account menu"
                >
                  <span className="grid place-items-center h-8 w-8 rounded-full bg-[var(--color-primary)] overflow-hidden text-xs font-semibold text-[var(--color-primary-foreground)]">
                    {photoDataUrl ? (
                      <img src={photoDataUrl} alt="Uploaded profile photo" className="h-full w-full object-cover" />
                    ) : (
                      getInitials(email)
                    )}
                  </span>
                  <span className="hidden sm:flex flex-col items-start leading-tight">
                    <span className="text-foreground text-sm truncate max-w-[180px]">{email}</span>
                    <span className="text-muted-foreground text-[11px]">Company {companyDisplay}</span>
                  </span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground group-data-[state=open]:rotate-180 transition-transform" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                sideOffset={8}
                className="z-[100] w-64 p-1.5 rounded-xl border border-[var(--color-panel-border)] bg-[var(--color-card)] backdrop-blur-xl shadow-2xl"
              >
                <DropdownMenuLabel className="px-2 py-2">
                  <div className="flex items-center gap-2.5">
                    <span className="grid place-items-center h-9 w-9 rounded-full bg-[var(--color-primary)] overflow-hidden text-xs font-semibold text-[var(--color-primary-foreground)]">
                      {photoDataUrl ? (
                        <img src={photoDataUrl} alt="Uploaded profile photo" className="h-full w-full object-cover" />
                      ) : (
                        getInitials(email)
                      )}
                    </span>
                    <div className="leading-tight min-w-0">
                      <div className="text-sm font-medium truncate">{email}</div>
                      <div className="text-[11px] text-muted-foreground font-normal">Company {companyDisplay}</div>
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
                    // Use window.location to bypass router and prevent infinite loop
                    window.location.href = "/landing";
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
    </header>
  );
}
