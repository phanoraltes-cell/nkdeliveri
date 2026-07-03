import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Store, ClipboardList, Package, BarChart3, Users, Tags, Percent, Clock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard/restaurant")({
  component: RestaurantDashboard,
});

function RestaurantDashboard() {
  const { user } = Route.useRouteContext();
  const { data: restaurant, isLoading } = useQuery({
    queryKey: ["my-restaurant", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("*")
        .eq("owner_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const pending = restaurant?.status === "pending";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">
            {restaurant?.name ?? "Restoran mwen"}
          </h1>
          <p className="mt-1 text-ink-soft">Jere manje w, kòmand ak vant ou yo.</p>
        </div>
        {restaurant && (
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${
              pending
                ? "bg-amber-100 text-amber-800"
                : restaurant.status === "approved"
                ? "bg-emerald-100 text-emerald-800"
                : "bg-red-100 text-red-800"
            }`}
          >
            {restaurant.status}
          </span>
        )}
      </div>

      {isLoading && <div className="text-ink-soft">Chajman...</div>}

      {pending && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
          <div className="flex items-center gap-2 font-bold text-amber-900">
            <Clock className="h-5 w-5" /> Kont ou an atant valdasyon
          </div>
          <p className="mt-1 text-sm text-amber-800">
            Yon administratè ap revize enfòmasyon restoran ou. Ou pral resevwa yon email lè kont ou apwouve. Nan
            entèval, ou ka konplete pwofil ou ak menu ou.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { icon: Store, title: "Pwofil restoran", desc: "Enfo, logo, kouvèti" },
          { icon: Tags, title: "Kategori", desc: "Òganize menu w" },
          { icon: Package, title: "Pwodwi", desc: "Ajoute/modifye plat" },
          { icon: ClipboardList, title: "Kòmand", desc: "An tan reyèl" },
          { icon: Users, title: "Anplwaye", desc: "Ajoute manm ekip la" },
          { icon: BarChart3, title: "Estatistik", desc: "Vant ak revni" },
          { icon: Percent, title: "Pwomosyon", desc: "Ofri espesyal" },
        ].map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.title}
              className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft/60 text-brand-deep">
                <Icon className="h-5 w-5" />
              </div>
              <div className="font-display text-base font-bold text-ink">{c.title}</div>
              <div className="mt-1 text-sm text-ink-soft">{c.desc}</div>
              <div className="mt-3 text-xs font-semibold uppercase tracking-wider text-brand-deep">
                Byento
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}