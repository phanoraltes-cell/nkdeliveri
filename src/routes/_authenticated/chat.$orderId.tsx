import { createFileRoute, redirect } from "@tanstack/react-router";

// Role-agnostic deep link — sendOrderChatPush and the in-app notification
// list both point here instead of guessing a role-specific URL, since a
// single chat-message notification fans out to customer + driver + every
// admin at once and there's no per-recipient URL in pushToUsers' payload.
// Resolves once via the same allRoles already loaded by _authenticated's
// beforeLoad, then hands off to that role's own Mwen > Chat page with the
// conversation pre-selected.
export const Route = createFileRoute("/_authenticated/chat/$orderId")({
  beforeLoad: ({ context, params }) => {
    const { allRoles } = context;
    const to =
      allRoles.includes("admin") || allRoles.includes("super_admin")
        ? "/dashboard/admin/chat"
        : allRoles.includes("driver")
          ? "/dashboard/driver/chat"
          : "/dashboard/customer/chat";
    throw redirect({ to, search: { order: params.orderId } });
  },
});
