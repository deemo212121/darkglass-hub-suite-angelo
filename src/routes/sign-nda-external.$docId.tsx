import { createFileRoute } from "@tanstack/react-router";
import { ExternalSignNdaFormPage } from "@/components/ExternalSignNdaFormPage";

export const Route = createFileRoute("/sign-nda-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Sign Non-Disclosure Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalSignNdaFormPage docId={docId} />;
}
