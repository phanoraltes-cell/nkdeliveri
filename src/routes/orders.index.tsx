import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { formatHTG } from "@/lib/format";
import { noIndexMeta } from "@/lib/seo";
import { ORDER_STATUS_LABEL as STATUS } from "@/lib/order-status";

export const Route = createFileRoute("/orders/")({
  head: () => noIndexMeta("Kòmand mwen — NK Deliveri"),
  component: Orders,
});

function Orders() {
  const { user, loading } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["my-orders", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, order_number, status, total, currency, created_at, restaurants(name), payments(status, method)",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <div className="mx-auto max-w-[720px] px-5 py-12">
        <h1 className="mb-3 font-display text-2xl font-extrabold">Kòmand mwen</h1>
        {loading || isLoading ? (
          <div className="rounded-[18px] bg-white p-8 text-center text-ink-soft">Chajman…</div>
        ) : !user ? (
          <div className="rounded-[18px] bg-white p-8 text-center text-ink-soft">
            <Link to="/auth" className="font-bold text-brand-deep">
              Konekte
            </Link>{" "}
            pou wè kòmand ou yo.
          </div>
        ) : !data || data.length === 0 ? (
          <div className="rounded-[18px] bg-white p-8 text-center text-ink-soft shadow-[0_8px_24px_rgba(194,90,5,0.10)]">
            <p>Ou poko gen okenn kòmand.</p>
            <Link to="/" className="mt-3 inline-block font-bold text-brand-deep hover:underline">
              Kòmanse kòmande →
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {data.map((o) => (
              <Link
                key={o.id}
                to="/orders/$id"
                params={{ id: o.id }}
                className="block rounded-2xl bg-white p-4 shadow-[0_8px_24px_rgba(194,90,5,0.08)] hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-display text-base font-extrabold">{o.order_number}</div>
                    <div className="text-xs text-ink-soft">
                      {o.restaurants?.name} · {new Date(o.created_at).toLocaleString("fr-HT")}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold">{formatHTG(o.total)}</div>
                    <div className="text-xs text-brand-deep">{STATUS[o.status] || o.status}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
