import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMyRestaurant } from "@/hooks/useMyRestaurant";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { DisputeThread } from "@/components/disputes/dispute-thread";
import {
  DISPUTE_STATUS_LABEL as STATUS_LABEL,
  DISPUTE_STATUS_TONE as STATUS_TONE,
} from "@/lib/dispute-status";

export const Route = createFileRoute("/_authenticated/dashboard/restaurant/disputes")({
  beforeLoad: ({ context }) => {
    const { role } = context;
    if (
      role !== "restaurant_owner" &&
      role !== "restaurant_staff" &&
      role !== "admin" &&
      role !== "super_admin"
    ) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: RestaurantDisputes,
});

function RestaurantDisputes() {
  const { user } = Route.useRouteContext();
  const { data: restaurant } = useMyRestaurant(user?.id);
  const [openId, setOpenId] = useState<string | null>(null);

  const disputes = useQuery({
    queryKey: ["restaurant-disputes", restaurant?.id],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("disputes")
        .select("id, category, status, resolution, created_at, orders(order_number)")
        .eq("restaurant_id", restaurant!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Litij</h1>
          <p className="mt-1 text-ink-soft">Reponn kliyan yo lè yo siyale yon pwoblèm.</p>
        </div>
        <Link
          to="/dashboard/restaurant"
          className="text-sm font-bold text-brand-deep hover:underline"
        >
          ← Dashboard
        </Link>
      </div>

      {disputes.isLoading && <div className="text-ink-soft">Chajman…</div>}
      {!disputes.isLoading && disputes.data?.length === 0 && (
        <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 text-center text-ink-soft">
          Pa gen litij pou kounye a.
        </div>
      )}

      <div className="space-y-3">
        {disputes.data?.map((d) => {
          const isOpen = openId === d.id;
          return (
            <div
              key={d.id}
              className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm"
            >
              <button
                onClick={() => setOpenId(isOpen ? null : d.id)}
                className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
              >
                <div>
                  <div className="font-display text-base font-extrabold">
                    {d.orders?.order_number}
                    <span className="ml-2">
                      <StatusBadge tone={STATUS_TONE[d.status]}>
                        {STATUS_LABEL[d.status] ?? d.status}
                      </StatusBadge>
                    </span>
                  </div>
                  <div className="text-xs text-ink-soft">
                    {d.category} · {new Date(d.created_at).toLocaleString("fr-HT")}
                  </div>
                </div>
                <span className="text-xs font-bold text-brand-deep">
                  {isOpen ? "Fèmen" : "Wè detay"}
                </span>
              </button>
              {isOpen && (
                <DisputeThread disputeId={d.id} status={d.status} resolution={d.resolution} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
