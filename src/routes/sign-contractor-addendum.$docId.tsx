import { createFileRoute } from "@tanstack/react-router";
import { SignContractorAddendumPage } from "@/components/SignContractorAddendumPage";

export const Route = createFileRoute("/sign-contractor-addendum/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Master Independent Contractor Subcontractor Agreement Addendum — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <SignContractorAddendumPage docId={docId} />;
}
