import { createFileRoute } from "@tanstack/react-router";
import { FillMealRestBreakPage } from "@/components/FillMealRestBreakPage";

export const Route = createFileRoute("/fill-meal-rest-break/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Meal & Rest Break Acknowledgment — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillMealRestBreakPage docId={docId} />;
}
