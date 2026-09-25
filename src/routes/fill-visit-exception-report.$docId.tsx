import { createFileRoute } from "@tanstack/react-router";
import { FillVisitExceptionReportPage } from "@/components/FillVisitExceptionReportPage";

export const Route = createFileRoute("/fill-visit-exception-report/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Visit Exception Report — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillVisitExceptionReportPage docId={docId} />;
}
