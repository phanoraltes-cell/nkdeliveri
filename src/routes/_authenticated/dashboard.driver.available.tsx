import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatHTG } from "@/lib/format";
import { toast } from "sonner";
import { useEffect } from "react";
import { MapPin, Store, Package } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard/driver/available")({
  beforeLoad: ({ context }) => {
    const role = (context as any).role;
    if (role !== "driver" && role !== "admin" && role !== "super_admin") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: AvailableDeliveries,
});

function AvailableDeliveries() {
  const { user } = Route.useRouteContext() as any;
  const qc = useQueryClient();

  const { data: driver } = useQuery({
    queryKey: ["me-driver", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("drivers").select("id, status").eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const available = useQuery({
    queryKey: ["available-deliveries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, order_number, total, delivery_address, created_at, restaurants(name, address), deliveries!left(id)"
        )
        .eq("status", "ready")
        .is("deliveries.id", null)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("available-deliveries-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => available.refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "deliveries" }, () => available.refetch())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const claim = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase.rpc("claim_delivery_secure", { _order_id: orderId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ou pran livrezon sa a!");
      qc.invalidateQueries({ queryKey: ["available-deliveries"] });
      qc.invalidateQueries({ queryKey: ["me-active-deliveries"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erè"),
  });

  const online = driver?.status === "online";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Livrezon disponib</h1>
          <p className="mt-1 text-ink-soft">Kòmand ki prè pou pran livrezon.</p>
        </div>
        <Link to="/dashboard/driver" className="text-sm font-bold text-brand-deep hover:underline">← Dashboard</Link>
      </div>

      {!online && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Ou dwe pase <b>an liy</b> nan dashboard prensipal la anvan ou ka pran yon livrezon.
        </div>
      )}

      {available.isLoading && <div className="text-ink-soft">Chajman…</div>}
      {!available.isLoading && (available.data?.length ?? 0) === 0 && (
        <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 text-center text-ink-soft">
          Pa gen okenn livrezon disponib kounye a.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {available.data?.map((o: any) => (
          <div key={o.id} className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-display text-lg font-extrabold">{o.order_number}</span>
              <span className="font-display text-lg font-extrabold text-brand-deep">{formatHTG(Number(o.total))}</span>
            </div>
            <div className="mt-2 flex items-start gap-2 text-sm text-ink-soft">
              <Store className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{o.restaurants?.name} — {o.restaurants?.address}</span>
            </div>
            <div className="mt-1 flex items-start gap-2 text-sm text-ink-soft">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{o.delivery_address}</span>
            </div>
            <button
              disabled={!online || claim.isPending}
              onClick={() => claim.mutate(o.id)}
              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-brand py-2.5 text-sm font-bold text-white hover:bg-brand-deep disabled:opacity-50"
            >
              <Package className="h-4 w-4" /> Pran livrezon sa a
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
