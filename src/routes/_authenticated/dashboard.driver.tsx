import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Bike, Clock, MapPin, DollarSign, ClipboardList, Power } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard/driver")({
  component: DriverDashboard,
});

function DriverDashboard() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();

  const { data: driver, isLoading } = useQuery({
    queryKey: ["me-driver", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drivers")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const toggle = useMutation({
    mutationFn: async (nextOnline: boolean) => {
      const { error } = await supabase
        .from("drivers")
        .update({ status: nextOnline ? "online" : "offline" })
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me-driver"] });
      toast.success("Estati aktyalize");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const pending = driver?.status === "pending";
  const online = driver?.status === "online";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Dashboard Livrè</h1>
          <p className="mt-1 text-ink-soft">Jere disponiblite w ak livrezon w yo.</p>
        </div>
        {driver && (
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${
              pending
                ? "bg-amber-100 text-amber-800"
                : online
                ? "bg-emerald-100 text-emerald-800"
                : "bg-gray-100 text-gray-700"
            }`}
          >
            {driver.status}
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
            Yon administratè ap revize dokiman w yo. Ou p ap ka aksepte livrezon jiskaske ou apwouve.
          </p>
        </div>
      )}

      {!pending && driver && (
        <button
          onClick={() => toggle.mutate(!online)}
          className={`inline-flex items-center gap-2 rounded-full px-5 py-3 font-bold text-white shadow-md transition ${
            online ? "bg-emerald-600 hover:bg-emerald-700" : "bg-brand hover:bg-brand-deep"
          }`}
        >
          <Power className="h-4 w-4" />
          {online ? "Mwen an liy" : "Antre an liy"}
        </button>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { icon: Bike, title: "Pwofil livrè", desc: "Modifye enfo w yo" },
          { icon: MapPin, title: "Livrezon disponib", desc: "Pran nouvo livrezon" },
          { icon: ClipboardList, title: "Livrezon m yo", desc: "Aktyèl ak istwa" },
          { icon: DollarSign, title: "Revni m yo", desc: "Peman ak komisyon" },
        ].map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.title} className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
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