import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import logo from "@/assets/logo.png";
import { ChevronDown, Clock, LogOut, Settings as SettingsIcon, Shield, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
    </header>
  );
}
