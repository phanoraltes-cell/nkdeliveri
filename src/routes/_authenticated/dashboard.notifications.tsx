import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Bell,
  Check,
  CheckCircle2,
  XCircle,
  Clock,
  Trash2,
  Eraser,
  ShoppingBag,
  Bike,
  CreditCard,
  Percent,
  Megaphone,
  AlertTriangle,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { PushToggle } from "@/components/push-toggle";
import { NotificationPreferencesPanel } from "@/components/notification-preferences-panel";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/dashboard/cards/empty-state";

// Moved here from _authenticated/notifications.tsx (a sibling of
// dashboard.tsx, not a child of it): TanStack Router's flat-file
// convention meant that path never actually rendered inside dashboard.tsx's
// layout (DashboardHeader/DashboardSidebar/max-w-6xl container) — every
// visit landed on a completely bare page with no navigation chrome at all,
// reached exclusively via the header bell (dashboard-header.tsx), which
// itself only ever renders inside that same shell. Renaming into the
// dashboard.* family fixes it structurally, for free, via the same nesting
// mechanism every other dashboard page already relies on.
export const Route = createFileRoute("/_authenticated/dashboard/notifications")({
  component: NotificationsPage,
});

const CATEGORY_TABS: { key: string; label: string }[] = [
  { key: "all", label: "Tout" },
  { key: "unread", label: "Non lu" },
  { key: "order", label: "Kòmand" },
  { key: "delivery", label: "Livrezon" },
  { key: "payment", label: "Peman" },
  { key: "commission", label: "Komisyon" },
  { key: "promotion", label: "Pwomosyon" },
  { key: "dispute", label: "Litij" },
  { key: "system", label: "Sistèm" },
  { key: "admin", label: "Admin" },
];

// P12 — one icon per notification *category*, reusing the exact icons
// already assigned to the same concept in the dashboard sidebars
// (nav-items.ts) rather than inventing new ones: ShoppingBag for "Kòmand",
// Bike for delivery (same icon as the "Livrè" driver role everywhere),
// CreditCard for "Peman", Percent for "Komisyon", Megaphone for
// "Pwomosyon"/"Piblisite", AlertTriangle for "Litij" — all consistent
// site-wide. "system" is intentionally left out: there's no equivalent
// nav destination to borrow an icon from, and the generic Bell fallback
// already reads correctly as "notification" for it, so it's kept rather
// than invented. "admin" (Komand's "nouveau client inscrit") reuses
// UserCog — same icon as the "Kliyan" nav item, since that's the only
// notification this category carries today.
const CATEGORY_ICON: Record<string, LucideIcon> = {
  order: ShoppingBag,
  delivery: Bike,
  payment: CreditCard,
  commission: Percent,
  promotion: Megaphone,
  dispute: AlertTriangle,
  admin: UserCog,
};

function NotificationsPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { requestConfirm, ConfirmDialog } = useConfirmDialog();
  const [tab, setTab] = useState("all");
  const { data, isLoading } = useQuery({
    queryKey: ["my-notifications", user?.id],
    queryFn: async () => {
      // RLS ("notif own") already scopes every row to auth.uid(), so this
      // filter can't change what comes back — it's here so the query reads
      // "my notifications" on its own and stays correct if that policy is
      // ever loosened (e.g. to let a role read others' rows) without this
      // file being touched.
      const { data, error } = await supabase
        .from("notifications")
        .select("id, type, category, title, body, data, read_at, created_at")
        .eq("user_id", user!.id)
        .is("hidden_at", null)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const markRead = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .in("id", ids)
        .is("read_at", null);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-notifications"] }),
    onError: (e) => toast.error(e.message),
  });

  // Never a real DELETE — this table stays the permanent record of what
  // was actually sent (useful if a user ever disputes "I was never
  // notified"). `hidden_at` just removes it from this personal view,
  // same mechanism as products.archived_at elsewhere in this project.
  const hideNotifications = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from("notifications")
        .update({ hidden_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Notifikasyon kache");
      qc.invalidateQueries({ queryKey: ["my-notifications"] });
    },
    onError: (e) => toast.error(e.message),
  });

  function hideOne(id: string) {
    requestConfirm(
      "Kache notifikasyon sa a? Sa a pa efase done platfòm nan, e sa ka irevèsib pou vi pèsonèl ou.",
      () => hideNotifications.mutate([id]),
    );
  }

  function hideAllVisible(ids: string[]) {
    requestConfirm(
      "Vide tout notifikasyon ki afiche la yo? Sa a pa efase done platfòm nan, e sa ka irevèsib pou vi pèsonèl ou.",
      () => hideNotifications.mutate(ids),
    );
  }

  const unread = (data ?? []).filter((n) => !n.read_at);
  const visible = (data ?? []).filter((n) => {
    if (tab === "all") return true;
    if (tab === "unread") return !n.read_at;
    return n.category === tab;
  });

  // Payment notifications keep their finer-grained, outcome-specific icon
  // (success/failure/pending) — that distinction matters more than the
  // generic "this is a payment" signal a category icon alone would give.
  // Everything else falls back to its category icon (see CATEGORY_ICON
  // above), and finally to a generic Bell if the category itself is
  // unrecognized.
  function iconFor(n: { type: string; category: string }) {
    if (n.type === "payment_paid") return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
    if (n.type === "payment_failed") return <XCircle className="h-5 w-5 text-red-600" />;
    if (n.type === "payment_under_review") return <Clock className="h-5 w-5 text-amber-600" />;
    const CategoryIcon = CATEGORY_ICON[n.category];
    if (CategoryIcon) return <CategoryIcon className="h-5 w-5 text-brand-deep" />;
    return <Bell className="h-5 w-5 text-brand-deep" />;
  }

  return (
    <div className="space-y-5">
      {/* Title centered on request (was left-aligned in a justify-between
          row with PushToggle). Stacked instead of the old side-by-side
          row so centering the title doesn't fight PushToggle's variable
          width — its "denied"/"unsupported" states render a much wider
          help card than its normal compact-button state, which is
          exactly why this used flex-wrap before; centering both on their
          own rows sidesteps that instead of trying to keep it working
          around an off-center title. */}
      <div className="space-y-3 text-center">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Notifikasyon</h1>
          <p className="mt-1 text-ink-soft">{unread.length} nouvo</p>
        </div>
        <div className="flex justify-center">
          <PushToggle />
        </div>
      </div>

      {user?.id && <NotificationPreferencesPanel userId={user.id} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* P12 — the shared Chip component replaces raw <button>s here:
            same filtering behavior, same visual selected state, but
            aria-pressed now comes for free instead of being conveyed by
            color alone (Chip already wires this up, same pattern already
            used for the Kanban/Lis toggle in P11). */}
        <div className="flex flex-wrap gap-1.5">
          {CATEGORY_TABS.map((c) => (
            <Chip key={c.key} selected={tab === c.key} onClick={() => setTab(c.key)}>
              {c.label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {unread.length > 0 && (
            <button
              onClick={() => markRead.mutate(unread.map((n) => n.id))}
              className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-3 py-2.5 text-xs font-bold text-brand-deep hover:bg-brand-deep hover:text-white"
            >
              <Check className="h-3.5 w-3.5" /> Make tout kòm li
            </button>
          )}
          {visible.length > 0 && (
            <button
              onClick={() => hideAllVisible(visible.map((n) => n.id))}
              className="inline-flex items-center gap-1 rounded-full border-2 border-brand-soft bg-white px-3 py-2 text-xs font-bold text-ink-soft hover:border-brand hover:text-brand-deep"
            >
              <Eraser className="h-3.5 w-3.5" /> Vide {tab === "all" ? "tout" : "sa yo"}
            </button>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      )}
      {/* P12 — reuses the shared EmptyState (already used on ~15 other
          dashboard pages) instead of a one-off text box, same message. */}
      {!isLoading && visible.length === 0 && (
        <EmptyState icon={Bell} title="Pa gen notifikasyon isit la." />
      )}

      <ul className="space-y-2">
        {visible.map((n) => {
          const orderId = (n.data as { order_id?: string } | null)?.order_id;
          // Komand's "nouveau client inscrit" notification (category
          // 'admin') carries customer_id instead of order_id — links into
          // the existing admin Kliyan list/search rather than a new page,
          // per the "never build new client-management architecture just
          // for this" decision.
          const customerId = (n.data as { customer_id?: string } | null)?.customer_id;
          // P12 — a notification with a real destination now looks
          // subtly different from a purely informational one: same
          // shadow-brand-xs/hover:shadow-brand-sm lift already used for
          // the identical "whole card is a link" pattern in
          // routes/orders.index.tsx, not a new visual language.
          const clickable = Boolean(orderId || customerId);
          const inner = (
            <div
              className={`flex gap-3 rounded-2xl border p-4 transition ${
                n.read_at ? "border-brand-soft/40 bg-white" : "border-brand/40 bg-brand-soft/30"
              } ${clickable ? "shadow-brand-xs hover:shadow-brand-sm" : ""}`}
            >
              <div className="mt-0.5">{iconFor(n)}</div>
              <div className="flex-1">
                <div className="font-bold text-ink">{n.title}</div>
                <div className="text-sm text-ink-soft">{n.body}</div>
                <div className="mt-1 text-[11px] uppercase tracking-wider text-ink-soft">
                  {new Date(n.created_at).toLocaleString("fr-HT")}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5 self-start">
                {!n.read_at && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      markRead.mutate([n.id]);
                    }}
                    className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-brand-deep hover:bg-brand-deep hover:text-white"
                  >
                    Li
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    hideOne(n.id);
                  }}
                  aria-label="Kache notifikasyon sa a"
                  title="Kache notifikasyon sa a"
                  className="text-ink-soft hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
          const onClick = () => !n.read_at && markRead.mutate([n.id]);
          // P12 — focus-visible ring lives on the actual focused element
          // (the <a> Link renders), not on the inner div — a ring class
          // on the div wouldn't fire since the div itself never receives
          // focus.
          const linkClassName =
            "block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2";
          return (
            <li key={n.id}>
              {orderId && n.type === "order_chat_message" ? (
                <Link
                  to="/chat/$orderId"
                  params={{ orderId }}
                  onClick={onClick}
                  className={linkClassName}
                >
                  {inner}
                </Link>
              ) : orderId ? (
                <Link
                  to="/orders/$id"
                  params={{ id: orderId }}
                  onClick={onClick}
                  className={linkClassName}
                >
                  {inner}
                </Link>
              ) : customerId ? (
                <Link
                  to="/dashboard/admin/customers"
                  search={{ customer: customerId }}
                  onClick={onClick}
                  className={linkClassName}
                >
                  {inner}
                </Link>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ul>
      {ConfirmDialog}
    </div>
  );
}
