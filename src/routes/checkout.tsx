import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { useCart } from "@/hooks/use-cart";
import { formatHTG } from "@/lib/format";
import { useEffect, useState } from "react";
import { Minus, Plus, Trash2, MapPin } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { noIndexMeta } from "@/lib/seo";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { sendNewOrderPush } from "@/lib/send-order-push.functions";

export const Route = createFileRoute("/checkout")({
  head: () => noIndexMeta("Panye — NK Deliveri"),
  component: Checkout,
});

const METHODS = [
  { id: "moncash", label: "MonCash", sub: "Peman manyèl ak prèv" },
  { id: "natcash", label: "NatCash", sub: "Peman manyèl ak prèv" },
  { id: "kach", label: "Kach nan livrezon", sub: "Peye lè manje a rive" },
] as const;

function Checkout() {
  const { items, setQty, remove, subtotal, count } = useCart();
  const { clear } = useCart();
  const { user } = useAuth();
  const [method, setMethod] = useState<"moncash" | "natcash" | "kach">("moncash");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [restaurant, setRestaurant] = useState<any>(null);
  const nav = useNavigate();
  const sendNewOrderPushFn = useServerFn(sendNewOrderPush);

  const platformPayout = useQuery({
    queryKey: ["platform-payout-public"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_platform_payout_public");
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const savedAddresses = useQuery({
    queryKey: ["my-addresses", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("addresses")
        .select("id, label, address_line, city, is_default")
        .eq("user_id", user!.id)
        .order("is_default", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Pre-fill from the default saved address once (never overwrites what the
  // customer is actively typing on a later render).
  const [addressPrefilled, setAddressPrefilled] = useState(false);
  useEffect(() => {
    if (addressPrefilled || address || !savedAddresses.data?.length) return;
    const def = savedAddresses.data.find((a) => a.is_default) ?? savedAddresses.data[0];
    setAddress(`${def.address_line}, ${def.city}`);
    setAddressPrefilled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedAddresses.data]);

  const deliveryFee = items.length > 0 ? 150 : 0;
  const serviceFee = 0;
  const total = subtotal + deliveryFee + serviceFee;

  const restaurantId = items[0]?.restaurantId;
  useEffect(() => {
    if (!restaurantId) { setRestaurant(null); return; }
    (async () => {
      const [{ data: r }, { data: p }] = await Promise.all([
        supabase.from("restaurants").select("id, name").eq("id", restaurantId).maybeSingle(),
        supabase.rpc("get_restaurant_payout_public", { _restaurant_id: restaurantId }),
      ]);
      const pd = Array.isArray(p) ? p[0] : p;
      setRestaurant(r ? { ...r, ...(pd ?? {}) } : null);
    })();
  }, [restaurantId]);

  const merchantDirect = restaurant?.payout_mode === "direct";
  const payNumber =
    method === "moncash"
      ? merchantDirect ? restaurant?.moncash_number : platformPayout.data?.moncash_number
      : method === "natcash"
      ? merchantDirect ? restaurant?.natcash_number : platformPayout.data?.natcash_number
      : null;
  const payName =
    method === "moncash"
      ? merchantDirect ? restaurant?.moncash_account_name : platformPayout.data?.moncash_account_name
      : method === "natcash"
      ? merchantDirect ? restaurant?.natcash_account_name : platformPayout.data?.natcash_account_name
      : null;

  async function submit() {
    if (!user) {
      nav({ to: "/auth", search: { next: "/checkout" } });
      return;
    }
    if (!address.trim()) {
      toast.error("Antre adrès livrezon w");
      return;
    }
    if (!phone.trim()) {
      toast.error("Antre yon nimewo telefòn pou kontak");
      return;
    }
    if (items.length === 0) return;
    if ((method === "moncash" || method === "natcash") && merchantDirect && !payNumber) {
      toast.error("Restoran an poko konfigire nimewo peman li. Chwazi yon lòt metòd.");
      return;
    }
    setSubmitting(true);
    try {
      const rId = items[0].restaurantId;
      const { data: orderId, error: rpcErr } = await supabase.rpc("create_order_secure", {
        _restaurant_id: rId,
        _items: items.map((it) => ({ product_id: it.productId, quantity: it.qty })),
        _delivery_address: address,
        _contact_phone: phone,
        _delivery_notes: notes || "",
        _method: method,
      });
      if (rpcErr) throw rpcErr;
      clear();
      toast.success("Kòmand kreye ak siksè");
      // Best-effort — a failed push send must never block order creation.
      sendNewOrderPushFn({ data: { orderId: orderId as string } }).catch((e) =>
        console.warn("[push] new-order notify failed", e),
      );
      nav({ to: "/orders/$id", params: { id: orderId as string } });
    } catch (e: any) {
      toast.error(e.message || "Erè pandan kreyasyon kòmand la");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <div className="mx-auto max-w-[640px] px-5 py-10">
        <div className="rounded-[18px] bg-white p-6 shadow-[0_8px_24px_rgba(194,90,5,0.10)]">
          <h1 className="mb-5 font-display text-2xl font-extrabold">Panye w</h1>

          {count === 0 ? (
            <div className="py-10 text-center text-ink-soft">
              Panye w vid pou kounye a.{" "}
              <Link to="/" className="font-bold text-brand-deep">Kòmanse kòmande</Link>
            </div>
          ) : (
            <>
              {items.map((it) => (
                <div key={it.productId} className="flex items-center gap-3 border-b border-dashed border-brand-soft py-3">
                  {it.imageUrl && <img src={it.imageUrl} width={56} height={56} className="h-14 w-14 rounded-xl object-cover" alt="" />}
                  <div className="flex-1">
                    <b className="block text-sm">{it.name}</b>
                    <span className="text-xs text-ink-soft">{formatHTG(it.price)} · {it.restaurantName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setQty(it.productId, it.qty - 1)} className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-soft text-brand-deep">
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="w-6 text-center text-sm font-bold">{it.qty}</span>
                    <button onClick={() => setQty(it.productId, it.qty + 1)} className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-soft text-brand-deep">
                      <Plus className="h-3 w-3" />
                    </button>
                    <button onClick={() => remove(it.productId)} className="ml-1 text-ink-soft hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}

              <div className="mt-4 space-y-1 text-sm">
                <div className="flex justify-between text-ink-soft"><span>Sou-total</span><span>{formatHTG(subtotal)}</span></div>
                <div className="flex justify-between text-ink-soft"><span>Frè livrezon</span><span>{formatHTG(deliveryFee)}</span></div>
                <div className="mt-2 flex justify-between border-t-2 border-brand-soft pt-3 font-display text-lg font-extrabold">
                  <span>Total</span><span>{formatHTG(total)}</span>
                </div>
              </div>

              <div className="mt-6">
                <label className="mb-2 block text-sm font-bold">Adrès livrezon</label>
                {!!savedAddresses.data?.length && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {savedAddresses.data.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setAddress(`${a.address_line}, ${a.city}`)}
                        className="inline-flex h-8 items-center gap-1 rounded-full border border-brand-soft bg-white px-2.5 text-xs font-semibold text-brand-deep hover:bg-brand-soft/40"
                      >
                        <MapPin className="h-3 w-3" /> {a.label || a.address_line}
                      </button>
                    ))}
                  </div>
                )}
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Kote pou nou livre a…"
                  className="w-full rounded-xl border-2 border-brand-soft bg-white px-4 py-2.5 text-sm outline-none focus:border-brand"
                />
                <label className="mt-3 mb-2 block text-sm font-bold">Telefòn kontak</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+509 …"
                  className="w-full rounded-xl border-2 border-brand-soft bg-white px-4 py-2.5 text-sm outline-none focus:border-brand"
                />
                <label className="mt-3 mb-2 block text-sm font-bold">Nòt pou livrezon (opsyonèl)</label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Enstriksyon espesyal…"
                  className="w-full rounded-xl border-2 border-brand-soft bg-white px-4 py-2.5 text-sm outline-none focus:border-brand"
                />
              </div>

              <div className="mt-5">
                <label className="mb-2 block text-sm font-bold">Metòd peman</label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {METHODS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setMethod(m.id as any)}
                      className={`rounded-2xl border-2 p-3 text-left text-sm font-bold transition ${
                        method === m.id ? "border-brand bg-brand-soft" : "border-brand-soft bg-white hover:border-brand"
                      }`}
                    >
                      {m.label}
                      <small className="mt-0.5 block text-xs font-normal text-ink-soft">{m.sub}</small>
                    </button>
                  ))}
                </div>
                {(method === "moncash" || method === "natcash") && (
                  <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
                    Apre w konfime kòmand la, w ap voye lajan an sou nimewo{" "}
                    <b>
                      {method === "moncash" ? "MonCash " : "NatCash "}
                      {payNumber ?? "(pa konfigire)"}
                    </b>
                    {payName ? <> ({payName})</> : null} epi telechaje prèv peman an sou paj
                    kòmand la. {merchantDirect ? "Peman an ale dirèkteman sou kont restoran an." : "Yon administratè ap verifye epi konfime kòmand la."}
                  </div>
                )}
              </div>

              <button
                onClick={submit}
                disabled={submitting}
                className="mt-6 w-full rounded-full bg-brand py-4 font-display font-extrabold text-white transition hover:bg-brand-deep"
              >
                {submitting ? "Ap kreye…" : `Konfime kòmand la · ${formatHTG(total)}`}
              </button>
            </>
          )}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}