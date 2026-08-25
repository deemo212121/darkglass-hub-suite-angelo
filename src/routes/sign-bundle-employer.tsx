import { createFileRoute } from "@tanstack/react-router";
import { EmployerSignBundlePage } from "@/components/EmployerSignBundlePage";

export const Route = createFileRoute("/sign-bundle-employer")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Sign as Employer — Admin Hub Solutions` }],
  }),
  component: EmployerSignBundlePage,
});
