import { createFileRoute } from "@tanstack/react-router";
import { SignCoeFormPage } from "@/components/SignCoeFormPage";

export const Route = createFileRoute("/sign-coe-form/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Sign Certificate of Employment — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <SignCoeFormPage docId={docId} />;
}
