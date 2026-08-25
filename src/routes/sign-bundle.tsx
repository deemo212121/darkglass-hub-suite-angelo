import { createFileRoute } from "@tanstack/react-router";
import { SignBundlePage } from "@/components/SignBundlePage";

export const Route = createFileRoute("/sign-bundle")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Sign Documents — Admin Hub Solutions` }],
  }),
  component: SignBundlePage,
});
