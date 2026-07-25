import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { KpiCard } from "@/components/dashboard/cards/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatHTG } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { ShoppingBag, Wallet, Store, Clock } from "lucide-react";

export type CustomerAdminDetail = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  address: string | null;
  created_at: string;
  total_orders: number;
  total_spent: number;
};

type CustomerDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: CustomerAdminDetail | null;
};

/**
 * Lightweight customer mini-CRM profile (Phase 2 of the admin evolution
 * plan) — total_orders/total_spent are already in get_customers_admin's
 * row (no extra fetch), favorite restaurants + last order come from the
 * new get_customer_activity_summary RPC. No wallet section: customers
 * don't have one, unlike restaurants/drivers.
 */
export function CustomerDetailDialog({ open, onOpenChange, customer }: CustomerDetailDialogProps) {
  const activity = useQuery({
    queryKey: ["customer-activity-summary", customer?.id],
    enabled: open && !!customer?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_customer_activity_summary", {
        _customer_id: customer!.id,
      });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  if (!customer) return null;

  const name = [customer.first_name, customer.last_name].filter(Boolean).join(" ") || "—";
  const favorites = (activity.data?.favorite_restaurants ?? []) as {
    name: string;
    count: number;
  }[];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>
            Enskri {new Date(customer.created_at).toLocaleDateString("fr-HT")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="grid gap-2 sm:grid-cols-2 text-sm">
            <div>
              <span className="text-ink-soft">Imèl : </span>
              <span className="font-medium">{customer.email}</span>
            </div>
            <div>
              <span className="text-ink-soft">Telefòn : </span>
              {customer.phone ? (
                <a href={`tel:${customer.phone}`} className="font-bold text-brand-deep">
                  {customer.phone}
                </a>
              ) : (
                "—"
              )}
            </div>
            <div className="sm:col-span-2">
              <span className="text-ink-soft">Adrès : </span>
              <span className="font-medium">{customer.address ?? "—"}</span>
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <KpiCard
              label="Kòmand total"
              value={String(customer.total_orders)}
              icon={ShoppingBag}
            />
            <KpiCard
              label="Total achte"
              value={formatHTG(Number(customer.total_spent))}
              icon={Wallet}
            />
          </div>

          {activity.isLoading ? (
            <Skeleton className="h-32 w-full rounded-2xl" />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <section>
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase text-ink-soft">
                  <Store className="h-3.5 w-3.5" /> Restoran favori
                </h4>
                {favorites.length === 0 ? (
                  <p className="text-sm text-ink-soft">Pa gen done.</p>
                ) : (
                  <ol className="space-y-1.5 text-sm">
                    {favorites.map((f, i) => (
                      <li key={f.name} className="flex items-center justify-between gap-2">
                        <span>
                          {i + 1}. {f.name}
                        </span>
                        <span className="font-bold text-brand-deep">{f.count}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
              <section>
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase text-ink-soft">
                  <Clock className="h-3.5 w-3.5" /> Dènye kòmand
                </h4>
                {activity.data?.last_order_number ? (
                  <p className="text-sm">
                    <span className="font-bold text-ink">{activity.data.last_order_number}</span>
                    <br />
                    <span className="text-ink-soft">
                      {activity.data.last_order_at
                        ? new Date(activity.data.last_order_at).toLocaleDateString("fr-HT")
                        : ""}
                    </span>
                  </p>
                ) : (
                  <p className="text-sm text-ink-soft">Pa gen kòmand.</p>
                )}
              </section>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
