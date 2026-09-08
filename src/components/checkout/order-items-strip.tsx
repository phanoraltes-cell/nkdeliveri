import { Minus, Plus } from "lucide-react";
import { formatHTG } from "@/lib/format";
import type { CartItem } from "@/hooks/useCart";

/** Anba kantite sa a nou di kliyan an gen "ti kantite ki rete" sou yon plat. */
const LOW_STOCK_THRESHOLD = 5;

export type ItemBadgeInfo = {
  /** Plat ki anba yon pwomosyon restoran otomatik (menu antye oswa plat sa a). */
  promoDishIds: Set<string>;
  /** productId -> estòk ki rete. Sèlman plat ki gen yon estòk limite parèt isit. */
  stockByProductId: Map<string, number>;
};

type Props = {
  items: CartItem[];
  setQty: (productId: string, qty: number) => void;
  setItemNotes: (productId: string, notes: string) => void;
  badges: ItemBadgeInfo;
  /** Tit pwomosyon restoran an, si gen youn ki matche panye a. */
  promotionTitle: string | null;
};

/**
 * TACH 2 §2 — rezime plat yo, an woulo orizontal.
 *
 * POUKISA ORIZONTAL: sou telefòn, yon lis vètikal ak 5 plat pouse tout
 * seksyon ki enpòtan yo (livrezon, peman, total) anba ekran an. Yon woulo
 * orizontal kenbe rezime a nan yon sèl wotè kèlkeswa kantite plat yo, epi
 * li kite bouton peman an vizib.
 *
 * Kontwòl kantite yo rete EN LIY sou chak kat — se sèl kote nan flit la
 * kote yon moun ka korije yon erè kantite san li pa kite paj peman an. Lè
 * kantite a rive 0, `setQty` retire plat la nan panye a (wè useCart), donk
 * pa gen bouton "efase" separe: yon sèl mekanis, mwens bagay pou konprann.
 */
export function OrderItemsStrip({ items, setQty, setItemNotes, badges, promotionTitle }: Props) {
  return (
    <section aria-labelledby="checkout-items-title" className="min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="checkout-items-title" className="font-display text-base font-bold text-ink">
          Kòmand ou · {items.length} plat
        </h2>
        {promotionTitle && (
          <span className="rounded-full bg-status-good-soft px-2.5 py-1 text-xs font-bold text-status-good">
            🎉 {promotionTitle}
          </span>
        )}
      </div>

      {/* `overflow-x-auto` sou pwòp veso li — kò paj la pa janm woule sou
          kote. `snap-x` fè chak kat rete aliyen apre yon glisman. */}
      <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2">
        {items.map((it) => {
          const stockLeft = badges.stockByProductId.get(it.productId);
          const lowStock = stockLeft !== undefined && stockLeft <= LOW_STOCK_THRESHOLD;
          const hasPromo = badges.promoDishIds.has(it.productId);
          return (
            <li
              key={it.productId}
              className="w-[230px] shrink-0 snap-start rounded-2xl border border-brand-soft bg-white p-3 shadow-brand-xs"
            >
              <div className="flex gap-3">
                {it.imageUrl ? (
                  <img
                    src={it.imageUrl}
                    width={56}
                    height={56}
                    loading="lazy"
                    className="h-14 w-14 shrink-0 rounded-xl object-cover"
                    alt={it.name}
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className="h-14 w-14 shrink-0 rounded-xl bg-brand-soft/50"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-sm text-ink">{it.name}</b>
                  <span className="text-xs text-ink-soft">{formatHTG(it.price)}</span>
                  {(hasPromo || lowStock) && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {hasPromo && (
                        <span className="rounded-full bg-status-good-soft px-1.5 py-0.5 text-[10px] font-bold text-status-good">
                          Pwomo
                        </span>
                      )}
                      {lowStock && (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                          {stockLeft} ki rete
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-2.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setQty(it.productId, it.qty - 1)}
                    aria-label={
                      it.qty === 1 ? `Retire ${it.name} nan panye` : `Diminye kantite ${it.name}`
                    }
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-brand-deep transition hover:bg-brand-deep hover:text-white focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
                  >
                    <Minus className="h-3 w-3" aria-hidden="true" />
                  </button>
                  <span
                    className="w-6 text-center text-sm font-bold tabular-nums"
                    aria-live="polite"
                    aria-label={`Kantite ${it.name}: ${it.qty}`}
                  >
                    {it.qty}
                  </span>
                  <button
                    type="button"
                    onClick={() => setQty(it.productId, it.qty + 1)}
                    disabled={stockLeft !== undefined && it.qty >= stockLeft}
                    aria-label={`Ogmante kantite ${it.name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-brand-deep transition hover:bg-brand-deep hover:text-white focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
                <b className="text-sm tabular-nums text-ink">{formatHTG(it.price * it.qty)}</b>
              </div>

              <input
                value={it.notes ?? ""}
                onChange={(e) => setItemNotes(it.productId, e.target.value)}
                placeholder="Nòt pou plat sa a…"
                aria-label={`Nòt pou ${it.name}`}
                className="mt-2 w-full min-w-0 rounded-lg border border-brand-soft bg-cream px-2 py-1 text-xs text-ink outline-none placeholder:text-ink-soft focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
