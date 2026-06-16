import { createFileRoute } from "@tanstack/react-router";
import UserManagementPage from "@/components/UserManagementPage";

export const Route = createFileRoute("/admin/users")({
  component: UserManagementPage,
});
