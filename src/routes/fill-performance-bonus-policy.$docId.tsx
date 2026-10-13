import { createFileRoute } from "@tanstack/react-router";
import { FillPerformanceBonusPolicyPage } from "@/components/FillPerformanceBonusPolicyPage";

export const Route = createFileRoute("/fill-performance-bonus-policy/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Performance Bonus Policy & Acknowledgment Form — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillPerformanceBonusPolicyPage docId={docId} />;
}
