import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { ready, email } = useAuth();
  if (!ready) return <div className="min-h-screen" />;
  
  // Prevent re-renders by using replace instead of push
  return <Navigate to={email ? "/home" : "/landing"} replace />;
}
