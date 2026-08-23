import { createFileRoute } from "@tanstack/react-router";
import { FillPartsResponsibilityPage } from "@/components/FillPartsResponsibilityPage";

export const Route = createFileRoute("/fill-parts-responsibility/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Parts Responsibility Acknowledgment — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillPartsResponsibilityPage docId={docId} />;
}
