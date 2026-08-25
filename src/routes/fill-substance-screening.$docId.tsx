import { createFileRoute } from "@tanstack/react-router";
import { FillSubstanceScreeningPage } from "@/components/FillSubstanceScreeningPage";

export const Route = createFileRoute("/fill-substance-screening/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Substance Screening & Conduct Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillSubstanceScreeningPage docId={docId} />;
}
