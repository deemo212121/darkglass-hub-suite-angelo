import { createFileRoute } from "@tanstack/react-router";
import { FillValidIdPage } from "@/components/FillValidIdPage";

export const Route = createFileRoute("/fill-valid-id/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Valid ID — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillValidIdPage docId={docId} />;
}
