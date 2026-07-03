import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { useCart } from "@/hooks/use-cart";
import { formatHTG } from "@/lib/format";
import { useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/checkout")({
  head: () => ({ meta: [{ title: "Panye — NK Delivery" }] }),
  component: Checkout,
});

const METHODS = [
  { id: "stripe", label: "Kat kredi / debi", sub: "Visa · Mastercard (otomatik)" },
  { id: "moncash", label: "MonCash", sub: "Peman manyèl ak prèv" },
  { id: "natcash", label: "NatCash", sub: "Peman manyèl ak prèv" },
  { id: "kach", label: "Kach nan livrezon", sub: "Peye lè manje a rive" },
] as const;

function Checkout() {
  const { items, setQty, remove, subtotal, count } = useCart();
  const { clear } = useCart();
  const { user } = useAuth();
  const [method, setMethod] = useState<"stripe" | "moncash" | "natcash" | "kach">("stripe");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const nav = useNavigate();

  const deliveryFee = items.length > 0 ? 150 : 0;
  const serviceFee = 0;
  const total = subtotal + deliveryFee + serviceFee;

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
    setSubmitting(true);
    try {
      const restaurantId = items[0].restaurantId;
      const orderNumber = "NK-" + Date.now().toString(36).toUpperCase();

      const { data: order, error: orderErr } = await supabase
        .from("orders")
        .insert({
          order_number: orderNumber,
          customer_id: user.id,
          restaurant_id: restaurantId,
          delivery_address: address,
          delivery_notes: notes || null,
          contact_phone: phone,
          subtotal,
          delivery_fee: deliveryFee,
          service_fee: serviceFee,
          total,
          currency: "HTG",
          status: "pending",
        })
        .select("id")
        .single();
      if (orderErr) throw orderErr;

      const itemsPayload = items.map((it) => ({
        order_id: order.id,
        product_id: it.productId,
        name: it.name,
        unit_price: it.price,
        quantity: it.qty,
        subtotal: it.price * it.qty,
      }));
      const { error: itemsErr } = await supabase.from("order_items").insert(itemsPayload);
      if (itemsErr) throw itemsErr;

      const paymentStatus =
        method === "stripe" ? "pending" : method === "kach" ? "pending" : "awaiting_proof";
      const { error: payErr } = await supabase.from("payments").insert({
        order_id: order.id,
        method,
        status: paymentStatus,
        amount: total,
        currency: "HTG",
      });
      if (payErr) throw payErr;

      clear();
      toast.success("Kòmand kreye ak siksè");
      nav({ to: "/orders/$id", params: { id: order.id } });
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
                  {it.imageUrl && <img src={it.imageUrl} className="h-14 w-14 rounded-xl object-cover" alt="" />}
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
                    <b>{method === "moncash" ? "MonCash 3XXX-XXXX" : "NatCash 3XXX-XXXX"}</b> epi
                    telechaje prèv peman an (foto/kaptè) sou paj kòmand la. Yon administratè ap
                    verifye epi konfime kòmand la.
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