import { createFileRoute } from "@tanstack/react-router";
import { SharedReportsSection } from "@/components/dashboard/shared-reports-section";

// Role guard lives on the parent layout (dashboard.driver.tsx) — this used
// to repeat the same check locally, which was redundant with it.
export const Route = createFileRoute("/_authenticated/dashboard/driver/reports")({
  component: () => <SharedReportsSection backTo="/dashboard/driver" />,
});
