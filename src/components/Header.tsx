import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth, usePresenceHeartbeat } from "@/lib/auth";
import logo from "@/assets/Admin Hub Solutions Logo no Text.png";
import { Clock, LogOut, Settings as SettingsIcon, Shield, User, Sun, Moon, LifeBuoy, Smartphone, ChevronDown } from "lucide-react";
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
import { setDesktopOverride, setMobileMode } from "@/lib/device";
import { getMyFullProfile } from "@/lib/supabase/users";

/**
 * Live reference clock in the header — this app's operations run across
 * many US timezones (see LOCATIONS in AdminUserManagementPage.tsx), so a
 * shared reference clock avoids "whose timezone is this timestamp in?"
 * confusion. Read-only display that always follows the signed-in user's
 * own profile.scheduleTimezone — the SAME field My Profile's Required
 * Schedule and the Master List's Hours of Work dropdown read/write (see
 * profile.tsx / ReportHRDaily.tsx). No picker here on purpose: who's
 * allowed to CHANGE this is locked down (Master List for HR, or directly
 * on My Profile for SUPERADMIN only) — this clock just shows the result.
 * The zone label is a fixed abbreviation per requested wording, not a
 * dynamic CST/CDT-style DST switch — only the underlying time math
 * follows DST.
 */
const CLOCK_ZONES: { key: string; label: string; timeZone: string }[] = [
  { key: "CST", label: "Central Time", timeZone: "America/Chicago" },
  { key: "EST", label: "Eastern Time", timeZone: "America/New_York" },
];

function CentralClock({ zoneKey }: { zoneKey: string }) {
  const zone = CLOCK_ZONES.find((z) => z.key === zoneKey) ?? CLOCK_ZONES[0];
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const update = () => {
      setTime(
        new Intl.DateTimeFormat("en-US", {
          timeZone: zone.timeZone,
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
  }, [zone.timeZone]);

  if (!time) return null;

  return (
    <div
      className="hidden md:flex items-center gap-1.5 rounded-full border border-[var(--color-panel-border)] bg-[var(--color-panel)] px-3 py-1.5 text-xs text-muted-foreground"
      title={zone.label}
    >
      <Clock className="h-3.5 w-3.5" />
      <span className="font-mono tabular-nums">{time}</span>
      <span className="font-semibold">{zone.key}</span>
    </div>
  );
}

function getInitials(value: string | null) {
  if (!value) return "U";
  // Only strip an @domain if this is actually an email (a real display
  // name like "Angelo Mendoza" has no "@" and shouldn't be touched here).
  const localPart = value.includes("@") ? value.split("@")[0] ?? value : value;
  const parts = localPart.split(/[\s._-]/).filter(Boolean);
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
  const { email, displayName, companyId, companyLoginAlias, logout, ready, uid } = useAuth();
  // Online/Idle/Offline presence (migration 0163) — mounted once here since
  // AppHeader renders on every authenticated page.
  usePresenceHeartbeat();
  // Full name (first + last) when we have one, falling back to email only
  // for accounts that somehow don't have a display name set.
  const nameDisplay = displayName || email;
  // Prefer the short login alias (e.g. "USAPP") over the raw legacy_code
  // ("COMP001") when one's set for this company; falls back to companyId
  // for the companies that don't have an alias configured yet.
  const companyDisplay = companyLoginAlias || companyId;
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [photoDataUrl, setPhotoDataUrl] = useState("");
  // The signed-in user's own Required Schedule timezone (profile.tsx) —
  // CentralClock is read-only and always follows this.
  const [profileZone, setProfileZone] = useState<string | null>(null);

  useEffect(() => {
    setPhotoDataUrl(loadEmployeePhoto(email));
  }, [email]);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    getMyFullProfile(uid)
      .then((p) => {
        if (!cancelled && p) setProfileZone(p.scheduleTimezone);
      })
      .catch(() => {
        // Best-effort — the clock just falls back to CST if this fails.
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

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
        <CentralClock zoneKey={profileZone || "CST"} />
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
                      getInitials(nameDisplay)
                    )}
                  </span>
                  <span className="hidden sm:flex flex-col items-start leading-tight">
                    <span className="text-foreground text-sm truncate max-w-[180px]">{nameDisplay}</span>
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
                        getInitials(nameDisplay)
                      )}
                    </span>
                    <div className="leading-tight min-w-0">
                      <div className="text-sm font-medium truncate">{nameDisplay}</div>
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
                <DropdownMenuItem onSelect={() => navigate({ to: "/it-tickets" })} className="gap-2.5 px-2 py-2 rounded-lg cursor-pointer">
                  <LifeBuoy className="h-4 w-4 text-muted-foreground" /> IT Support
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    // Phone detection (src/lib/device.ts) is best-effort and some
                    // devices never trip it — this is the manual escape hatch.
                    // Clear any prior "use desktop site" override too, so the
                    // switch sticks across reloads instead of bouncing back.
                    setDesktopOverride(false);
                    setMobileMode(true);
                    navigate({ to: "/mobile" });
                  }}
                  className="gap-2.5 px-2 py-2 rounded-lg cursor-pointer"
                >
                  <Smartphone className="h-4 w-4 text-muted-foreground" /> Mobile View
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-[var(--color-panel-border)]" />
                <DropdownMenuItem
                  onSelect={() => {
                    // logout() itself navigates to /landing (a full
                    // reload, not a router transition) once sign-out
                    // settles — see auth.tsx.
                    void logout();
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
