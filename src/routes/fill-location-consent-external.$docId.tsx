import { createFileRoute } from "@tanstack/react-router";
import { ExternalFillLocationConsentPage } from "@/components/ExternalFillLocationConsentPage";

export const Route = createFileRoute("/fill-location-consent-external/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Location Sharing Consent Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <ExternalFillLocationConsentPage docId={docId} />;
}
