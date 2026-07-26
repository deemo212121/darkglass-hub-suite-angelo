import { createFileRoute } from "@tanstack/react-router";
import { ApplyFormPage } from "@/components/ApplyFormPage";

export const Route = createFileRoute("/apply/$slug")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Apply — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { slug } = Route.useParams();
  return <ApplyFormPage slug={slug} />;
}
