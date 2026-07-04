import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Users, Store, Bike, ClipboardList, CreditCard, BarChart3, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { LiveMap, type MapMarker } from "@/components/live-map";
import { useActiveDeliveries } from "@/hooks/use-active-deliveries";

export const Route = createFileRoute("/_authenticated/dashboard/admin")({
  beforeLoad: ({ context }) => {
    const role = (context as any).role;
    if (role !== "admin" && role !== "super_admin") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: AdminDashboard,
});

function AdminDashboard() {
  const qc = useQueryClient();
  const active = useActiveDeliveries({ admin: true });
  const markers: MapMarker[] = active.flatMap((d) => {
    const arr: MapMarker[] = [];
    if (d.driver_lat != null && d.driver_lng != null) {
      arr.push({
        id: `drv-${d.id}`,
        lat: Number(d.driver_lat),
        lng: Number(d.driver_lng),
        color: "blue",
        label: `${d.driver?.first_name ?? "Livrè"} · ${d.order?.order_number ?? ""}`,
      });
    }
    if (d.order?.delivery_lat != null && d.order?.delivery_lng != null) {
      arr.push({
        id: `dst-${d.id}`,
        lat: Number(d.order.delivery_lat),
        lng: Number(d.order.delivery_lng),
        color: "green",
        label: `Adrès ${d.order.order_number}`,
      });
    }
    if (d.order?.restaurants?.lat != null && d.order?.restaurants?.lng != null) {
      arr.push({
        id: `rst-${d.id}`,
        lat: Number(d.order.restaurants.lat),
        lng: Number(d.order.restaurants.lng),
        color: "orange",
        label: d.order.restaurants.name ?? "Restoran",
      });
    }
    return arr;
  });

  const stats = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const [users, restos, drivers, pendingR, pendingD] = await Promise.all([
        supabase.from("profiles").select("id", { head: true, count: "exact" }),
        supabase.from("restaurants").select("id", { head: true, count: "exact" }),
        supabase.from("drivers").select("id", { head: true, count: "exact" }),
        supabase.from("restaurants").select("id", { head: true, count: "exact" }).eq("status", "pending"),
        supabase.from("drivers").select("id", { head: true, count: "exact" }).eq("status", "pending"),
      ]);
      return {
        users: users.count ?? 0,
        restaurants: restos.count ?? 0,
        drivers: drivers.count ?? 0,
        pendingRestaurants: pendingR.count ?? 0,
        pendingDrivers: pendingD.count ?? 0,
      };
    },
  });

  const pendingRestaurants = useQuery({
    queryKey: ["pending-restaurants"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id, name, cuisine, phone, address, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const pendingDrivers = useQuery({
    queryKey: ["pending-drivers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drivers")
        .select("id, first_name, last_name, phone, vehicle_type, license_plate, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const updateResto = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" | "suspended" }) => {
      const { error } = await supabase.rpc("update_restaurant_status_secure", {
        _restaurant_id: id,
        _status: status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-restaurants"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      toast.success("Estati restoran aktyalize");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateDriver = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" | "suspended" }) => {
      const { error } = await supabase.rpc("update_driver_status_secure", {
        _driver_id: id,
        _status: status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-drivers"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      toast.success("Estati livrè aktyalize");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const s = stats.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-extrabold text-ink">Dashboard Administratè</h1>
        <p className="mt-1 text-ink-soft">Jere platfòm nan: itilizatè, restoran, livrè, peman.</p>
      </div>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-ink">Livrezon aktif · tan reyèl</h2>
          <span className="rounded-full bg-brand-soft/60 px-3 py-1 text-xs font-bold text-brand-deep">
            {active.length} an kou
          </span>
        </div>
        <LiveMap markers={markers} className="h-[420px] w-full rounded-xl" />
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-soft">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-orange-500" /> Restoran</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-500" /> Livrè</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Adrès kliyan</span>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { icon: Users, label: "Itilizatè", value: s?.users, tone: "bg-blue-50 text-blue-700" },
          { icon: Store, label: "Restoran", value: s?.restaurants, tone: "bg-orange-50 text-orange-700" },
          { icon: Bike, label: "Livrè", value: s?.drivers, tone: "bg-emerald-50 text-emerald-700" },
          { icon: ClipboardList, label: "Restoran an atant", value: s?.pendingRestaurants, tone: "bg-amber-50 text-amber-800" },
          { icon: ClipboardList, label: "Livrè an atant", value: s?.pendingDrivers, tone: "bg-amber-50 text-amber-800" },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm">
              <div className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${k.tone}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="mt-2 font-display text-3xl font-extrabold text-ink">
                {k.value ?? "—"}
              </div>
              <div className="text-xs uppercase tracking-wider text-ink-soft">{k.label}</div>
            </div>
          );
        })}
      </div>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-display text-xl font-bold text-ink">Restoran an atant valdasyon</h2>
        {pendingRestaurants.isLoading && <div className="text-ink-soft">Chajman...</div>}
        {pendingRestaurants.data?.length === 0 && (
          <div className="text-sm text-ink-soft">Pa gen okenn restoran an atant.</div>
        )}
        <div className="space-y-3">
          {pendingRestaurants.data?.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-soft/50 p-3">
              <div className="min-w-0 flex-1">
                <div className="font-bold text-ink">{r.name}</div>
                <div className="text-xs text-ink-soft">
                  {r.cuisine || "—"} · {r.phone || "san telefòn"} · {r.address || "san adrès"}
                </div>
              </div>
              <button
                onClick={() => updateResto.mutate({ id: r.id, status: "approved" })}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Apwouve
              </button>
              <button
                onClick={() => updateResto.mutate({ id: r.id, status: "rejected" })}
                className="inline-flex items-center gap-1 rounded-full bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700"
              >
                <XCircle className="h-3.5 w-3.5" /> Refize
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-display text-xl font-bold text-ink">Livrè an atant valdasyon</h2>
        {pendingDrivers.isLoading && <div className="text-ink-soft">Chajman...</div>}
        {pendingDrivers.data?.length === 0 && (
          <div className="text-sm text-ink-soft">Pa gen okenn livrè an atant.</div>
        )}
        <div className="space-y-3">
          {pendingDrivers.data?.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-soft/50 p-3">
              <div className="min-w-0 flex-1">
                <div className="font-bold text-ink">
                  {d.first_name} {d.last_name}
                </div>
                <div className="text-xs text-ink-soft">
                  {d.vehicle_type || "—"} · {d.license_plate || "san plak"} · {d.phone || "san telefòn"}
                </div>
              </div>
              <button
                onClick={() => updateDriver.mutate({ id: d.id, status: "approved" })}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Apwouve
              </button>
              <button
                onClick={() => updateDriver.mutate({ id: d.id, status: "rejected" })}
                className="inline-flex items-center gap-1 rounded-full bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700"
              >
                <XCircle className="h-3.5 w-3.5" /> Refize
              </button>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { icon: CreditCard, title: "Peman manyèl", desc: "Valide prèv MonCash/NatCash", to: "/dashboard/admin/payments" as const },
          { icon: BarChart3, title: "Rapò", desc: "Vant ak analiz", to: null },
          { icon: Users, title: "Jere itilizatè", desc: "Sispann/aktive kont", to: null },
        ].map((c) => {
          const Icon = c.icon;
          const body = (
            <div key={c.title} className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft/60 text-brand-deep">
                <Icon className="h-5 w-5" />
              </div>
              <div className="font-display text-base font-bold text-ink">{c.title}</div>
              <div className="mt-1 text-sm text-ink-soft">{c.desc}</div>
              <div className="mt-3 text-xs font-semibold uppercase tracking-wider text-brand-deep">
                {c.to ? "Ouvri →" : "Byento"}
              </div>
            </div>
          );
          return c.to ? (
            <Link key={c.title} to={c.to} className="block">{body}</Link>
          ) : body;
        })}
      </div>
    </div>
  );
}