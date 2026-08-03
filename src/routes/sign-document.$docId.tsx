import { createFileRoute } from "@tanstack/react-router";
import { SignDocumentPage } from "@/components/SignDocumentPage";

export const Route = createFileRoute("/sign-document/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Sign Document — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <SignDocumentPage docId={docId} />;
}
