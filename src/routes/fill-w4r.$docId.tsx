import { createFileRoute } from "@tanstack/react-router";
import { FillW4RPage } from "@/components/FillW4RPage";

export const Route = createFileRoute("/fill-w4r/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Fill W-4R — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillW4RPage docId={docId} />;
}
