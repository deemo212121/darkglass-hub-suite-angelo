import { Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import logo from "@/assets/logo.png";

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
            <div className="hidden sm:flex flex-col items-end leading-tight">
              <span className="text-foreground">{email}</span>
              <span className="text-muted-foreground text-xs">Company {companyId}</span>
            </div>
          )}
          <button
            className="btn"
            onClick={() => {
              logout();
              navigate({ to: "/landing" });
            }}
          >
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}
