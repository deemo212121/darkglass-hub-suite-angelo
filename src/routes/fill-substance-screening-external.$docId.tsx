import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillSubstanceScreeningPage } from "@/components/ExternalFillSubstanceScreeningPage";

export const Route = createFileRoute("/fill-substance-screening-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Substance Screening & Conduct Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillSubstanceScreeningPage docId={docId} />;
}
