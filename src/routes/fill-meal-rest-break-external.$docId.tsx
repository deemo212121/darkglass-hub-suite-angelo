import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillMealRestBreakPage } from "@/components/ExternalFillMealRestBreakPage";

export const Route = createFileRoute("/fill-meal-rest-break-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Meal & Rest Break Acknowledgment — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillMealRestBreakPage docId={docId} />;
}
