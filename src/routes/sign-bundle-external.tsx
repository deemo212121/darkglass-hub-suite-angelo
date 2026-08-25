import { createFileRoute } from "@tanstack/react-router";
import { ExternalSignBundlePage } from "@/components/ExternalSignBundlePage";

export const Route = createFileRoute("/sign-bundle-external")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Sign Documents — Admin Hub Solutions` }],
  }),
  component: ExternalSignBundlePage,
});
