import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatHTG } from "@/lib/format";
import { useState } from "react";
import { toast } from "sonner";
import { Upload, CheckCircle2, Clock, AlertCircle, Star } from "lucide-react";
import { LiveMap, type MapMarker } from "@/components/live-map";
import { useDeliveryForOrder } from "@/hooks/use-active-deliveries";
import { ProofThumb } from "@/components/proof-thumb";

export const Route = createFileRoute("/orders/$id")({
  head: () => ({ meta: [{ title: "Kòmand — NK Deliveri" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/auth", search: { next: "/orders" } });
  },
  component: OrderDetail,
});

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: "An atant peman",
  confirmed: "Konfime",
  preparing: "Ap prepare",
  ready: "Prè",
  assigned: "Livrè asiyen",
  picked_up: "An wout",
  delivered: "Livre",
  cancelled: "Anile",
  refunded: "Ranbouse",
};

const PAY_STATUS_LABEL: Record<string, string> = {
  pending: "An atant",
  awaiting_proof: "Ap tann prèv peman",
  under_review: "Ap verifye",
  paid: "Peye",
  failed: "Echwe",
  refunded: "Ranbouse",
};

function OrderDetail() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [txRef, setTxRef] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const order = useQuery({
    queryKey: ["order", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, order_number, status, subtotal, delivery_fee, service_fee, total, currency, delivery_address, contact_phone, delivery_notes, created_at, restaurant_id, restaurants(name, slug), order_items(product_name, quantity, unit_price, line_total), payments(id, method, status, transaction_ref, sender_phone, review_notes, reviewed_at, receiver_type, receiver_number, receiver_account_name)"
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const proofs = useQuery({
    queryKey: ["proofs", id],
    enabled: !!order.data?.payments?.[0]?.id,
    queryFn: async () => {
      const pid = order.data!.payments[0].id;
      const { data, error } = await supabase
        .from("payment_proofs")
        .select("id, file_url, transaction_ref, sender_phone, notes, created_at")
        .eq("payment_id", pid)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const uploadProof = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Chwazi yon foto prèv peman");
      if (!order.data?.payments?.[0]) throw new Error("Peman pa jwenn");
      const payment = order.data.payments[0];
      const path = `${order.data.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      const { error: upErr } = await supabase.storage
        .from("payment-proofs")
        .upload(path, file, { upsert: false });
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from("payment_proofs").insert({
        payment_id: payment.id,
        file_url: path,
        transaction_ref: txRef || null,
        sender_phone: senderPhone || null,
        notes: notes || null,
        uploaded_by: user!.id,
      });
      if (insErr) throw insErr;

      const { error: payErr } = await supabase
        .from("payments")
        .update({
          status: "under_review",
          transaction_ref: txRef || null,
          sender_phone: senderPhone || null,
        })
        .eq("id", payment.id);
      if (payErr) throw payErr;
    },
    onSuccess: () => {
      toast.success("Prèv peman voye. Yon administratè ap verifye li.");
      setFile(null);
      setTxRef("");
      setSenderPhone("");
      setNotes("");
      qc.invalidateQueries({ queryKey: ["order", id] });
      qc.invalidateQueries({ queryKey: ["proofs", id] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  async function submitProof(e: React.FormEvent) {
    e.preventDefault();
    setUploading(true);
    try {
      await uploadProof.mutateAsync();
    } finally {
      setUploading(false);
    }
  }

  const review = useQuery({
    queryKey: ["review", id, user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reviews")
        .select("*")
        .eq("order_id", id)
        .eq("customer_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [restaurantRating, setRestaurantRating] = useState(0);
  const [driverRating, setDriverRating] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  // Must run unconditionally, before the loading/not-found early returns
  // below — calling it after them would change the hook order between
  // renders and violate the Rules of Hooks (React would throw or silently
  // drop hooks, breaking this exact component on the transition from
  // "loading" to "loaded", which is also where the map should appear).
  const delivery = useDeliveryForOrder(order.data?.id);

  const submitReview = useMutation({
    mutationFn: async (args: { restaurantId: string; driverId: string | null }) => {
      if (!restaurantRating) throw new Error("Bay yon nòt pou restoran an");
      const { error } = await supabase.from("reviews").insert({
        order_id: id,
        customer_id: user!.id,
        restaurant_id: args.restaurantId,
        driver_id: args.driverId,
        restaurant_rating: restaurantRating,
        driver_rating: args.driverId ? driverRating || null : null,
        comment: reviewComment || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Mèsi pou avi w!");
      qc.invalidateQueries({ queryKey: ["review", id] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erè"),
  });

  if (order.isLoading) {
    return (
      <div className="min-h-screen bg-cream">
        <SiteHeader />
        <div className="mx-auto max-w-[720px] px-5 py-12 text-ink-soft">Chajman…</div>
      </div>
    );
  }
  if (!order.data) {
    return (
      <div className="min-h-screen bg-cream">
        <SiteHeader />
        <div className="mx-auto max-w-[720px] px-5 py-12 text-center text-ink-soft">
          Kòmand la pa jwenn.
          <div className="mt-3">
            <Link to="/orders" className="font-bold text-brand-deep">← Kòmand mwen</Link>
          </div>
        </div>
      </div>
    );
  }

  const o = order.data;
  const payment = o.payments?.[0];
  const trackingMarkers: MapMarker[] = (() => {
    if (!delivery) return [];
    const arr: MapMarker[] = [];
    if (delivery.driver_lat != null && delivery.driver_lng != null) {
      arr.push({ id: "drv", lat: Number(delivery.driver_lat), lng: Number(delivery.driver_lng), color: "blue", label: "Livrè" });
    }
    if (delivery.order?.restaurants?.lat != null && delivery.order?.restaurants?.lng != null) {
      arr.push({ id: "rst", lat: Number(delivery.order.restaurants.lat), lng: Number(delivery.order.restaurants.lng), color: "orange", label: delivery.order.restaurants.name ?? "Restoran" });
    }
    if (delivery.order?.delivery_lat != null && delivery.order?.delivery_lng != null) {
      arr.push({ id: "dst", lat: Number(delivery.order.delivery_lat), lng: Number(delivery.order.delivery_lng), color: "green", label: "Adrès ou" });
    }
    return arr;
  })();
  const isManual = payment?.method === "moncash" || payment?.method === "natcash";
  const needsProof =
    isManual && (payment?.status === "awaiting_proof" || payment?.status === "pending");

  const payLabel = payment
    ? `${payment.method === "moncash" ? "MonCash" : "NatCash"} · ${payment.receiver_number ?? "(pa konfigire)"}${payment.receiver_account_name ? " (" + payment.receiver_account_name + ")" : ""}`
    : "";
  const payRoutingNote =
    payment?.receiver_type === "merchant"
      ? "Peman an ale dirèkteman sou kont restoran an."
      : "NK Deliveri ap resevwa peman an epi remèt restoran an apre komisyon.";

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <div className="mx-auto max-w-[720px] space-y-4 px-5 py-8">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-soft">Kòmand</div>
            <h1 className="font-display text-2xl font-extrabold">{o.order_number}</h1>
          </div>
          <Link to="/orders" className="text-sm font-bold text-brand-deep hover:underline">
            ← Tout kòmand
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-white p-4 shadow-[0_8px_24px_rgba(194,90,5,0.08)]">
            <div className="text-xs uppercase tracking-wider text-ink-soft">Estati kòmand</div>
            <div className="mt-1 font-display text-lg font-extrabold text-brand-deep">
              {ORDER_STATUS_LABEL[o.status] || o.status}
            </div>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-[0_8px_24px_rgba(194,90,5,0.08)]">
            <div className="text-xs uppercase tracking-wider text-ink-soft">Estati peman</div>
            <div className="mt-1 flex items-center gap-2 font-display text-lg font-extrabold">
              {payment?.status === "paid" && <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
              {payment?.status === "under_review" && <Clock className="h-5 w-5 text-amber-600" />}
              {payment?.status === "awaiting_proof" && <AlertCircle className="h-5 w-5 text-orange-600" />}
              {payment ? PAY_STATUS_LABEL[payment.status] || payment.status : "—"}
            </div>
            <div className="mt-0.5 text-xs text-ink-soft capitalize">{payment?.method}</div>
          </div>
        </div>

        {delivery && trackingMarkers.length > 0 && (
          <div className="rounded-2xl bg-white p-4 shadow-[0_8px_24px_rgba(194,90,5,0.08)]">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="font-display text-base font-bold">Swiv livrezon w</div>
                {delivery.location_updated_at && (
                  <div className="text-xs text-ink-soft">
                    Dènye mizajou: {new Date(delivery.location_updated_at).toLocaleTimeString()}
                  </div>
                )}
              </div>
              <span className="rounded-full bg-brand-soft/60 px-3 py-1 text-xs font-bold text-brand-deep">
                {delivery.status}
              </span>
            </div>
            <LiveMap markers={trackingMarkers} className="h-[320px] w-full rounded-xl" />
          </div>
        )}

        <div className="rounded-2xl bg-white p-5 shadow-[0_8px_24px_rgba(194,90,5,0.08)]">
          <div className="mb-3 font-display text-base font-bold">Detay</div>
          {o.order_items?.map((it: any, i: number) => (
            <div key={i} className="flex justify-between border-b border-dashed border-brand-soft py-2 text-sm">
              <span>{it.quantity}× {it.product_name}</span>
              <span>{formatHTG(it.line_total)}</span>
            </div>
          ))}
          <div className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between text-ink-soft"><span>Sou-total</span><span>{formatHTG(o.subtotal)}</span></div>
            <div className="flex justify-between text-ink-soft"><span>Frè livrezon</span><span>{formatHTG(o.delivery_fee)}</span></div>
            <div className="mt-2 flex justify-between border-t-2 border-brand-soft pt-2 font-display text-lg font-extrabold">
              <span>Total</span><span>{formatHTG(o.total)}</span>
            </div>
          </div>
          <div className="mt-3 text-xs text-ink-soft">
            <div><b>Livrezon:</b> {o.delivery_address}</div>
            <div><b>Telefòn:</b> {o.contact_phone}</div>
            {o.delivery_notes && <div><b>Nòt:</b> {o.delivery_notes}</div>}
          </div>
        </div>

        {isManual && (
          <div className="rounded-2xl bg-white p-5 shadow-[0_8px_24px_rgba(194,90,5,0.08)]">
            <div className="font-display text-base font-bold">Enstriksyon peman</div>
            <div className="mt-2 rounded-xl bg-brand-soft/60 p-3 text-sm">
              Voye <b>{formatHTG(o.total)}</b> sou <b>{payLabel}</b>, epi telechaje kaptè/foto prèv
              la anba a. <span className="block text-xs text-ink-soft mt-1">{payRoutingNote}</span>
            </div>

            {needsProof ? (
              <form onSubmit={submitProof} className="mt-4 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase text-ink-soft">Prèv (foto/kaptè)</label>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="w-full rounded-xl border-2 border-brand-soft bg-white px-3 py-2 text-sm"
                    required
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    value={txRef}
                    onChange={(e) => setTxRef(e.target.value)}
                    placeholder="Nimewo transaksyon"
                    className="rounded-xl border-2 border-brand-soft bg-white px-3 py-2 text-sm"
                  />
                  <input
                    value={senderPhone}
                    onChange={(e) => setSenderPhone(e.target.value)}
                    placeholder="Nimewo ki voye lajan an"
                    className="rounded-xl border-2 border-brand-soft bg-white px-3 py-2 text-sm"
                  />
                </div>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Nòt (opsyonèl)"
                  className="w-full rounded-xl border-2 border-brand-soft bg-white px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={uploading || !file}
                  className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-extrabold text-white hover:bg-brand-deep disabled:opacity-60"
                >
                  <Upload className="h-4 w-4" /> {uploading ? "Ap voye…" : "Voye prèv la"}
                </button>
              </form>
            ) : (
              <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
                Prèv peman resevwa. Yon administratè ap verifye li.
              </div>
            )}

            {proofs.data && proofs.data.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 text-xs font-bold uppercase text-ink-soft">Prèv voye</div>
                <ul className="space-y-2 text-sm">
                  {proofs.data.map((p: any) => (
                    <li key={p.id} className="flex items-center gap-3 rounded-lg bg-cream px-3 py-2">
                      <ProofThumb path={p.file_url} />
                      <div>
                        {p.transaction_ref && <div>Tx: <b>{p.transaction_ref}</b></div>}
                        {p.sender_phone && <div>Soti: <b>{p.sender_phone}</b></div>}
                        <div className="text-xs text-ink-soft">
                          {new Date(p.created_at).toLocaleString("fr-HT")}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {payment?.review_notes && (
              <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                <b>Nòt administratè:</b> {payment.review_notes}
              </div>
            )}
          </div>
        )}

        {o.status === "delivered" && (
          <div className="rounded-2xl bg-white p-5 shadow-[0_8px_24px_rgba(194,90,5,0.08)]">
            <div className="font-display text-base font-bold">Bay avi w</div>
            {review.isLoading ? (
              <div className="mt-2 text-sm text-ink-soft">Chajman…</div>
            ) : review.data ? (
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-ink-soft">Restoran:</span>
                  <StarRow value={review.data.restaurant_rating ?? 0} />
                </div>
                {review.data.driver_rating != null && (
                  <div className="flex items-center gap-2">
                    <span className="text-ink-soft">Livrè:</span>
                    <StarRow value={review.data.driver_rating} />
                  </div>
                )}
                {review.data.comment && (
                  <p className="rounded-xl bg-cream p-3 text-ink-soft">{review.data.comment}</p>
                )}
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <div>
                  <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">Nòt restoran</span>
                  <StarPicker value={restaurantRating} onChange={setRestaurantRating} />
                </div>
                {delivery?.driver_id && (
                  <div>
                    <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">Nòt livrè</span>
                    <StarPicker value={driverRating} onChange={setDriverRating} />
                  </div>
                )}
                <textarea
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="Kòmantè (opsyonèl)…"
                  rows={3}
                  className="w-full rounded-xl border-2 border-brand-soft bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                />
                <button
                  disabled={submitReview.isPending}
                  onClick={() =>
                    submitReview.mutate({ restaurantId: o.restaurant_id, driverId: delivery?.driver_id ?? null })
                  }
                  className="rounded-full bg-brand px-5 py-2.5 text-sm font-extrabold text-white hover:bg-brand-deep disabled:opacity-60"
                >
                  {submitReview.isPending ? "Ap voye…" : "Voye avi"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}

function StarRow({ value }: { value: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`h-4 w-4 ${n <= value ? "fill-brand text-brand" : "text-brand-soft"}`} />
      ))}
    </div>
  );
}

function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onClick={() => onChange(n)} className="p-0.5">
          <Star className={`h-6 w-6 ${n <= value ? "fill-brand text-brand" : "text-brand-soft"}`} />
        </button>
      ))}
    </div>
  );
}