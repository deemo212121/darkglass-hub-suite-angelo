import { createFileRoute } from "@tanstack/react-router";
import { FillW8benPage } from "@/components/FillW8benPage";

export const Route = createFileRoute("/fill-w8ben/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Fill W-8BEN — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillW8benPage docId={docId} />;
}
