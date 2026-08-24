import { createFileRoute } from "@tanstack/react-router";
import { NotificationCenterPage } from "@/components/NotificationCenterPage";

export const Route = createFileRoute("/notifications")({
  ssr: false,
  head: () => ({
    meta: [{ title: `Notifications — Admin Hub Solutions` }],
  }),
  component: NotificationCenterPage,
});
