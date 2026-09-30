import { createFileRoute } from "@tanstack/react-router";
import { SignCompensationUpdatePage } from "@/components/SignCompensationUpdatePage";

export const Route = createFileRoute("/sign-compensation-update/$docId")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Sign Promotion Paper and Wage Increase — Admin Hub Solutions` }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { docId } = Route.useParams();
  return <SignCompensationUpdatePage docId={docId} />;
}
