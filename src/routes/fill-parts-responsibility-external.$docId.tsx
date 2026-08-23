import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillPartsResponsibilityPage } from "@/components/ExternalFillPartsResponsibilityPage";

export const Route = createFileRoute("/fill-parts-responsibility-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Parts Responsibility Acknowledgment — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillPartsResponsibilityPage docId={docId} />;
}
