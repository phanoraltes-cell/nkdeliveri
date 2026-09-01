import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Truck } from "lucide-react";
import { formatHTG } from "@/lib/format";
import { inputCls } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useReauth, isStepUpError } from "@/hooks/useReauth";
import { ReauthDialog } from "@/components/reauth-dialog";

// Role guard lives on the parent layout (dashboard.admin.tsx) — this used to
// repeat the same check locally, which was redundant with it.
export const Route = createFileRoute("/_authenticated/dashboard/admin/delivery-fee")({
  component: AdminDeliveryFee,
});

// NKD-015: only the default zone is editable here — no zone matching
// exists yet (confirmed decision, docs/archive/phases/NKD-015_DELIVERY_FEE_REPORT.md),
// so there is exactly one zone in practice today even though the schema
// supports more.
function AdminDeliveryFee() {
  const qc = useQueryClient();
  const [feeInput, setFeeInput] = useState("");
  const [loaded, setLoaded] = useState(false);
  const { withReauth, invalidateStepUp, dialogState } = useReauth();

  const zone = useQuery({
    queryKey: ["admin-default-delivery-zone"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_delivery_zones")
        .select("id, name, fee_htg, updated_at")
        .eq("is_default", true)
        .single();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!loaded && zone.data) {
      setFeeInput(String(zone.data.fee_htg));
      setLoaded(true);
    }
  }, [loaded, zone.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!zone.data) throw new Error("Zòn pa jwenn");
      const fee = Number(feeInput);
      if (!Number.isFinite(fee) || fee < 0) {
        throw new Error("Pri livrezon an dwe yon chif pozitif oswa zewo.");
      }
      const { error } = await supabase.rpc("update_delivery_zone_fee_secure", {
        _zone_id: zone.data.id,
        _fee_htg: fee,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pri livrezon an mete ajou");
      qc.invalidateQueries({ queryKey: ["admin-default-delivery-zone"] });
      // Every checkout/restaurant-card read shares this key — without
      // this, an admin who just changed the price would still see the
      // old one anywhere else in the app until a hard refresh.
      qc.invalidateQueries({ queryKey: ["platform-delivery-fee"] });
    },
    onError: (e) => {
      // STANDARD tier (15 min, fallback allowed) — a real financial
      // config change, but not role/payout/payment-provider security
      // (the STRICT-tier categories), see the migration's own header
      // comment for the reasoning.
      if (isStepUpError(e)) {
        invalidateStepUp("standard");
        toast.error("Verifikasyon sekirite ekspire — klike ankò pou re-verifye.");
        return;
      }
      toast.error(e.message ?? "Erè");
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Frè livrezon</h1>
          <p className="mt-1 text-ink-soft">
            Pri sa a aplike otomatikman sou tout nouvo kòmand, pou tout restoran — restoran yo pa ka
            chanje l.
          </p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <section className="max-w-md rounded-2xl border border-brand-soft/60 bg-white p-6 shadow-sm">
        {zone.isLoading ? (
          <div className="text-sm text-ink-soft">Chajman…</div>
        ) : (
          <>
            <h2 className="mb-2 flex items-center gap-1.5 font-display text-sm font-bold">
              <Truck className="h-4 w-4" /> {zone.data?.name ?? "Zòn pa defo"}
            </h2>
            <label
              htmlFor="delivery-fee"
              className="mb-1 block text-xs font-bold uppercase text-ink-soft"
            >
              Pri livrezon (HTG)
            </label>
            <input
              id="delivery-fee"
              type="number"
              min="0"
              step="1"
              value={feeInput}
              onChange={(e) => setFeeInput(e.target.value)}
              className={inputCls()}
            />
            {zone.data && (
              <p className="mt-2 text-xs text-ink-soft">
                Pri aktyèl la : {formatHTG(zone.data.fee_htg)}. Kòmand ki deja pase kenbe pri yo te
                genyen an — chanjman sa a afekte sèlman nouvo kòmand yo.
              </p>
            )}
          </>
        )}
        <Button
          className="mt-6"
          disabled={save.isPending || zone.isLoading}
          onClick={() => withReauth(() => save.mutate(), "standard")}
        >
          {save.isPending ? "Ap sove…" : "Sove pri a"}
        </Button>
      </section>
      <ReauthDialog state={dialogState} />
    </div>
  );
}
