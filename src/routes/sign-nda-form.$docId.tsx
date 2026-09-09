import { createFileRoute } from "@tanstack/react-router";
import { SignNdaFormPage } from "@/components/SignNdaFormPage";

export const Route = createFileRoute("/sign-nda-form/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Sign Non-Disclosure Agreement — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <SignNdaFormPage docId={docId} />;
}
