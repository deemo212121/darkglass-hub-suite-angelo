import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { useEffect } from "react";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { ready, email } = useAuth();
  const navigate = useNavigate();
  
  useEffect(() => {
    if (!ready) return;
    
    const target = email ? "/home" : "/landing";
    navigate({ to: target, replace: true });
  }, [ready, email, navigate]);
  
  return <div className="min-h-screen" />;
}
