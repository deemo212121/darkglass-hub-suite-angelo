import { Link, Navigate } from "@tanstack/react-router";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

export function AccountPageShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const { ready, email } = useAuth();
  if (!ready) return null;
  if (!email) return <Navigate to="/landing" />;
  return (
    <>
      <AppHeader />
      <main className="max-w-[1100px] mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-5">
          <Link to="/home" className="btn">
            <ChevronLeft className="h-4 w-4" /> Home
          </Link>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
        </div>
        {children}
      </main>
    </>
  );
}
