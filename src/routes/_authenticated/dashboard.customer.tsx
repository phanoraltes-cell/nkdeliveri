import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ShoppingBag,
  Navigation,
  Heart,
  Tag,
  Flame,
  Bell,
  Star,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { formatHTG } from "@/lib/format";
import { useFavorites } from "@/hooks/useFavorites";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { DataTable } from "@/components/dashboard/tables/data-table";
import { ORDER_STATUS_LABEL } from "@/lib/order-status";

export const Route = createFileRoute("/_authenticated/dashboard/customer")({
  component: CustomerDashboard,
});

const TERMINAL_STATUSES = ["delivered", "cancelled", "refunded"];

type RecentOrder = Pick<
  Database["public"]["Tables"]["orders"]["Row"],
  "id" | "order_number" | "status" | "total" | "created_at"
> & {
  restaurants: Pick<Database["public"]["Tables"]["restaurants"]["Row"], "name" | "slug"> | null;
};

type RestaurantCard = Pick<
  Database["public"]["Tables"]["restaurants"]["Row"],
  "id" | "slug" | "name" | "cuisine" | "logo_url" | "rating"
>;

function CustomerDashboard() {
  const { user } = Route.useRouteContext();
  const { favoriteIds } = useFavorites();

  const { data: profile } = useQuery({
    queryKey: ["customer-greeting", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("first_name")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const recentOrders = useQuery({
    queryKey: ["customer-recent-orders", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_number, status, total, created_at, restaurants(name, slug)")
        .eq("customer_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });

  const currentOrder = recentOrders.data?.find((o) => !TERMINAL_STATUSES.includes(o.status));
  const lastDeliveredOrder = recentOrders.data?.find((o) => o.status === "delivered");

  const favoriteRestaurants = useQuery({
    queryKey: ["customer-favorite-restaurants", favoriteIds],
    enabled: !!favoriteIds?.length,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id, slug, name, cuisine, logo_url, rating")
        .in("id", favoriteIds!)
        .limit(4);
      if (error) throw error;
      return data;
    },
  });

  const popularRestaurants = useQuery({
    queryKey: ["customer-popular-restaurants"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id, slug, name, cuisine, logo_url, rating")
        .eq("status", "approved")
        .order("rating", { ascending: false })
        .limit(4);
      if (error) throw error;
      return data;
    },
  });

  const promotions = useQuery({
    queryKey: ["customer-promotions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("promotions")
        .select("id, title, description, code, discount_type, discount_value, restaurants(name)")
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(4);
      if (error) throw error;
      return data;
    },
  });

  const notifications = useQuery({
    queryKey: ["customer-notifications", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, body, created_at, read_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(3);
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-extrabold text-ink">
          Byenveni{profile?.first_name ? `, ${profile.first_name}` : ""}!
        </h1>
        <p className="mt-1 text-ink-soft">Kòmande manje w epi swiv livrezon w yo.</p>
      </div>

      {currentOrder && (
        <section className="rounded-2xl border-2 border-brand bg-brand-soft/20 p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-brand-deep">
                Kòmand ap vini
              </div>
              <div className="font-display text-lg font-extrabold text-ink">
                {currentOrder.order_number} · {currentOrder.restaurants?.name}
              </div>
              <div className="mt-1 text-sm text-ink-soft">
                {ORDER_STATUS_LABEL[currentOrder.status] ?? currentOrder.status}
              </div>
            </div>
            <Link
              to="/orders/$id"
              params={{ id: currentOrder.id }}
              className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-3 font-bold text-white shadow-md hover:bg-brand-deep"
            >
              <Navigation className="h-4 w-4" /> Swiv livrezon
            </Link>
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-3">
        <Link
          to="/restaurants"
          className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-3 font-bold text-white shadow-md hover:bg-brand-deep"
        >
          <ShoppingBag className="h-4 w-4" /> Nouvo kòmand
        </Link>
        {lastDeliveredOrder?.restaurants?.slug && (
          <Link
            to="/restaurants/$slug"
            params={{ slug: lastDeliveredOrder.restaurants.slug }}
            className="inline-flex items-center gap-2 rounded-full border-2 border-brand-soft bg-white px-5 py-3 font-bold text-brand-deep hover:bg-brand-soft/40"
          >
            Kòmande ankò nan {lastDeliveredOrder.restaurants.name}
          </Link>
        )}
      </div>

      <RestaurantSection
        title="Favori mwen"
        icon={Heart}
        restaurants={favoriteRestaurants.data}
        isLoading={favoriteRestaurants.isLoading}
        emptyTitle="Ou pa gen restoran favori"
        emptyDescription="Peze kè a sou yon restoran pou ajoute l nan favori w."
      />

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-ink">Istwa resan</h2>
          <Link to="/orders" className="text-sm font-bold text-brand-deep hover:underline">
            Wè tout →
          </Link>
        </div>
        <DataTable<RecentOrder>
          rows={recentOrders.data ?? []}
          getRowKey={(o) => o.id}
          mobileTitleKey="order_number"
          emptyState={
            <EmptyState
              icon={Inbox}
              title="Ou poko gen kòmand"
              description="Kòmand ou yo ap parèt isit la."
            />
          }
          columns={[
            { key: "order_number", header: "Kòmand", cell: (o) => o.order_number },
            { key: "restaurant", header: "Restoran", cell: (o) => o.restaurants?.name ?? "—" },
            { key: "total", header: "Total", cell: (o) => formatHTG(Number(o.total)) },
            {
              key: "status",
              header: "Estati",
              cell: (o) => ORDER_STATUS_LABEL[o.status] ?? o.status,
            },
          ]}
        />
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-ink">
          <Tag className="h-5 w-5 text-brand-deep" /> Pwomosyon aktif
        </h2>
        {!promotions.isLoading && !promotions.data?.length && (
          <div className="text-sm text-ink-soft">Pa gen pwomosyon aktif kounye a.</div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {promotions.data?.map((p) => (
            <div
              key={p.id}
              className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="font-display text-base font-bold text-ink">{p.title}</div>
                <span className="shrink-0 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-bold text-brand-deep">
                  {p.discount_type === "percentage"
                    ? `${p.discount_value}%`
                    : `${formatHTG(Number(p.discount_value))}`}
                </span>
              </div>
              <div className="mt-1 text-xs text-ink-soft">{p.restaurants?.name}</div>
              {p.description && <p className="mt-1 text-sm text-ink-soft">{p.description}</p>}
              {p.code && (
                <div className="mt-2 inline-block rounded-md bg-cream px-2 py-1 font-mono text-xs font-bold text-brand-deep">
                  {p.code}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <RestaurantSection
        title="Restoran popilè"
        icon={Flame}
        restaurants={popularRestaurants.data}
        isLoading={popularRestaurants.isLoading}
        emptyTitle="Pa gen restoran pou kounye a"
      />

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink">
            <Bell className="h-5 w-5 text-brand-deep" /> Notifikasyon
          </h2>
          <Link to="/notifications" className="text-sm font-bold text-brand-deep hover:underline">
            Wè tout →
          </Link>
        </div>
        {!notifications.isLoading && !notifications.data?.length && (
          <div className="text-sm text-ink-soft">Pa gen notifikasyon.</div>
        )}
        <ul className="space-y-2">
          {notifications.data?.map((n) => (
            <li
              key={n.id}
              className={`rounded-xl border px-4 py-2.5 text-sm ${
                n.read_at ? "border-brand-soft/40 bg-white" : "border-brand-soft bg-brand-soft/20"
              }`}
            >
              <div className="font-semibold text-ink">{n.title}</div>
              {n.body && <div className="mt-0.5 text-xs text-ink-soft">{n.body}</div>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function RestaurantSection({
  title,
  icon: Icon,
  restaurants,
  isLoading,
  emptyTitle,
  emptyDescription,
}: {
  title: string;
  icon: LucideIcon;
  restaurants: RestaurantCard[] | undefined;
  isLoading: boolean;
  emptyTitle: string;
  emptyDescription?: string;
}) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-ink">
        <Icon className="h-5 w-5 text-brand-deep" /> {title}
      </h2>
      {!isLoading && !restaurants?.length && (
        <EmptyState icon={Star} title={emptyTitle} description={emptyDescription} />
      )}
      {!!restaurants?.length && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {restaurants.map((r) => (
            <Link
              key={r.id}
              to="/restaurants/$slug"
              params={{ slug: r.slug }}
              className="rounded-2xl border border-brand-soft/60 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-brand hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <img
                  src={r.logo_url || ""}
                  alt=""
                  width={48}
                  height={48}
                  loading="lazy"
                  className="h-12 w-12 shrink-0 rounded-xl bg-brand-soft/40 object-cover"
                />
                <div className="min-w-0">
                  <div className="truncate font-display text-sm font-bold text-ink">{r.name}</div>
                  <div className="truncate text-xs text-ink-soft">{r.cuisine}</div>
                  {r.rating != null && (
                    <div className="mt-0.5 text-xs font-bold text-brand-deep">
                      ★ {Number(r.rating).toFixed(1)}
                    </div>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
