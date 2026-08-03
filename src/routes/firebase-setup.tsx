import { createFileRoute } from "@tanstack/react-router";
import FirebaseSetupPage from "@/components/FirebaseSetupPage";

export const Route = createFileRoute("/firebase-setup")({
  component: FirebaseSetupPage,
});
