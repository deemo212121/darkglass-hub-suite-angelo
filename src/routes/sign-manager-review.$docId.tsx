import { createFileRoute } from "@tanstack/react-router";
import { ManagerReviewPage } from "@/components/ManagerReviewPage";

export const Route = createFileRoute("/sign-manager-review/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Add Your Signature — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ManagerReviewPage docId={docId} />;
}
