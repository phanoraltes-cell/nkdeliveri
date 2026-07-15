import { Trash2 } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { formatHTG } from "@/lib/format";
import { StatusBadge } from "@/components/dashboard/status-badge";

type MenuProduct = Database["public"]["Tables"]["products"]["Row"];

type ProductGridProps = {
  products: MenuProduct[];
  onEdit: (product: MenuProduct) => void;
  onDelete: (id: string) => void;
};

/** Restaurant menu's product card grid, filtered to the active category by the caller. */
export function ProductGrid({ products, onEdit, onDelete }: ProductGridProps) {
  return (
    <>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => (
          <div key={p.id} className="overflow-hidden rounded-xl border border-brand-soft/50">
            {p.image_url && (
              <img
                src={p.image_url}
                alt={p.name}
                loading="lazy"
                width={240}
                height={128}
                className="h-32 w-full object-cover"
              />
            )}
            <div className="p-3">
              <div className="font-bold">{p.name}</div>
              <div className="text-xs text-ink-soft">{p.description}</div>
              <div className="mt-1 flex items-center justify-between">
                <span className="font-display font-extrabold text-brand-deep">
                  {formatHTG(Number(p.price))}
                </span>
                <StatusBadge tone={p.available ? "good" : "neutral"}>
                  {p.available ? "Disponib" : "Pa disponib"}
                </StatusBadge>
              </div>
              {p.stock_quantity != null && (
                <div
                  className={`mt-1 text-[11px] font-semibold ${p.stock_quantity === 0 ? "text-red-600" : "text-ink-soft"}`}
                >
                  Stock: {p.stock_quantity}
                </div>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => onEdit(p)}
                  className="flex-1 rounded-lg border-2 border-brand-soft py-1 text-xs font-bold text-brand-deep hover:bg-brand-soft/40"
                >
                  Modifye
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Retire "${p.name}" nan meni an?`)) onDelete(p.id);
                  }}
                  className="rounded-lg border-2 border-red-200 px-2 py-1 text-red-700 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {products.length === 0 && (
        <div className="mt-4 rounded-xl bg-brand-soft/30 p-6 text-center text-sm text-ink-soft">
          Pa gen plat pou kategori sa a.
        </div>
      )}
    </>
  );
}
