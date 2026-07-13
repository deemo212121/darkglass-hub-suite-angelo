import { createFileRoute } from "@tanstack/react-router";
import { HrActivityLogPage } from "@/components/HrActivityLogPage";

export const Route = createFileRoute("/hr-activity-log")({
  ssr: false,
  head: () => ({
    meta: [{ title: `HR Activity Log — Admin Hub Solutions` }],
  }),
  component: HrActivityLogPage,
});
