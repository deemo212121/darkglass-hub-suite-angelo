import { createFileRoute } from "@tanstack/react-router";
import { ExternalSignPromotionFormPage } from "@/components/ExternalSignPromotionFormPage";

export const Route = createFileRoute("/sign-promotion-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Sign Promotion Form — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalSignPromotionFormPage docId={docId} />;
}
