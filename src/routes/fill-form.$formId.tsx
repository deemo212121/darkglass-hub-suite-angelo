import { createFileRoute } from "@tanstack/react-router";
import { FillCustomFormPage } from "@/components/FillCustomFormPage";

export const Route = createFileRoute("/fill-form/$formId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Fill Form — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { formId } = Route.useParams();
  return <FillCustomFormPage formId={formId} />;
}
