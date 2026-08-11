import { createFileRoute } from "@tanstack/react-router";
import { SignPromotionFormPage } from "@/components/SignPromotionFormPage";

export const Route = createFileRoute("/sign-promotion-form/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Sign Promotion Form — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <SignPromotionFormPage docId={docId} />;
}
