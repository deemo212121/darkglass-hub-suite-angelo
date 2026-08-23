import { createFileRoute } from "@tanstack/react-router";
import { FillLocationConsentPage } from "@/components/FillLocationConsentPage";

export const Route = createFileRoute("/fill-location-consent/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Location Sharing Consent Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <FillLocationConsentPage docId={docId} />;
}
