import { Trash2, Upload } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { formatHTG } from "@/lib/format";
import { StatusBadge, type StatusTone } from "@/components/dashboard/status-badge";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";

type MenuProduct = Database["public"]["Tables"]["products"]["Row"];

type ProductGridProps = {
  products: MenuProduct[];
  onEdit: (product: MenuProduct) => void;
  onDelete: (id: string) => void;
  /** Tach 1, Objektif B — republiye yon sèl plat pou 24h ankò. */
  onPublish: (id: string) => void;
  publishingId?: string | null;
};

// Tach 1, Objektif B — pla ki pibliye ekspire 24h apre (published_at +
// interval '24 hours', kolòn kalkile expires_at). Yon plat ki pa janm
// pibliye (published_at NULL, ka pi frekan an: tout plat ki egziste anvan
// migrasyon sa a) pa gen expires_at ditou — okenn badj pou li.
function expiryBadge(expiresAt: string | null): { label: string; tone: StatusTone } | null {
  if (!expiresAt) return null;
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  if (msLeft <= 0) return { label: "Ekspire", tone: "bad" };
  const hoursLeft = Math.ceil(msLeft / (60 * 60 * 1000));
  if (hoursLeft <= 3) return { label: `Ekspire nan ${hoursLeft}h`, tone: "warn" };
  return { label: `Ekspire nan ${hoursLeft}h`, tone: "info" };
}

/** Restaurant menu's product card grid, filtered to the active category by the caller. */
export function ProductGrid({
  products,
  onEdit,
  onDelete,
  onPublish,
  publishingId,
}: ProductGridProps) {
  const { requestConfirm, ConfirmDialog } = useConfirmDialog();
  return (
    <>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => {
          const expiry = expiryBadge(p.expires_at);
          return (
            <div
              key={p.id}
              className="overflow-hidden rounded-xl border border-brand-soft/50 bg-card shadow-brand-xs transition hover:shadow-brand-sm"
            >
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
                <div className="mt-1 flex flex-wrap items-center justify-between gap-1">
                  <span className="font-display font-extrabold text-brand-deep">
                    {formatHTG(Number(p.price))}
                  </span>
                  <div className="flex flex-wrap justify-end gap-1">
                    <StatusBadge tone={p.available ? "good" : "neutral"}>
                      {p.available ? "Disponib" : "Pa disponib"}
                    </StatusBadge>
                    {expiry && <StatusBadge tone={expiry.tone}>{expiry.label}</StatusBadge>}
                  </div>
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
                    onClick={() => onPublish(p.id)}
                    disabled={publishingId === p.id}
                    title="Pibliye pou 24h ankò"
                    className="flex items-center gap-1 rounded-lg border-2 border-brand-soft px-2 py-1 text-xs font-bold text-brand-deep transition hover:bg-brand-soft/40 disabled:opacity-50"
                  >
                    <Upload className="h-3.5 w-3.5" /> Pibliye
                  </button>
                  <button
                    onClick={() =>
                      requestConfirm(`Retire "${p.name}" nan meni an?`, () => onDelete(p.id))
                    }
                    className="rounded-lg border-2 border-red-200 px-2 py-1 text-red-700 transition hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {products.length === 0 && (
        <div className="mt-4 rounded-xl bg-brand-soft/30 p-6 text-center text-sm text-ink-soft">
          Pa gen plat pou kategori sa a.
        </div>
      )}
      {ConfirmDialog}
    </>
  );
}
