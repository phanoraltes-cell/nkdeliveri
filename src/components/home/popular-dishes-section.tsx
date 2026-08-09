import { Plus, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { formatHTG } from "@/lib/format";
import type { CartItem } from "@/hooks/useCart";
import type { HomeProduct } from "@/components/home/home-data";
import { ImageWithFallback } from "@/components/image-with-fallback";
import { Button } from "@/components/ui/button";

const DISH_TYPES: { key: string; label: string }[] = [
  { key: "all", label: "Tout" },
  { key: "diri_sos", label: "Diri ak Sòs" },
  { key: "griyo", label: "Griyo" },
  { key: "fritay", label: "Fritay" },
  { key: "soup", label: "Soup" },
  { key: "pwason", label: "Pwason" },
  { key: "sandwich", label: "Sandwich" },
  { key: "pizza", label: "Pizza" },
  { key: "bwason", label: "Bwason" },
];

type PopularDishesSectionProps = {
  products: HomeProduct[];
  dishType: string;
  onDishTypeChange: (key: string) => void;
  add: (item: Omit<CartItem, "qty">) => "replaced" | "added";
};

/** Home page's "Plat popilè" section: dish-type filter chips + a product card grid with add-to-cart. */
export function PopularDishesSection({
  products,
  dishType,
  onDishTypeChange,
  add,
}: PopularDishesSectionProps) {
  const filteredProducts = products.filter((p) => dishType === "all" || p.dish_type === dishType);
  const dishCounts = DISH_TYPES.reduce<Record<string, number>>((acc, d) => {
    acc[d.key] =
      d.key === "all" ? products.length : products.filter((p) => p.dish_type === d.key).length;
    return acc;
  }, {});

  return (
    <section id="plat-popile" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 pb-14">
      <div className="mb-6 flex items-end justify-between">
        <h2 className="font-display text-[clamp(1.5rem,2.6vw,2rem)] font-extrabold tracking-tight">
          Plat <span className="text-brand">popilè</span>
        </h2>
      </div>
      <div className="mb-5 flex flex-wrap gap-2.5">
        {DISH_TYPES.map((d) => {
          const active = dishType === d.key;
          const count = dishCounts[d.key] ?? 0;
          if (d.key !== "all" && count === 0) return null;
          return (
            <button
              key={d.key}
              onClick={() => onDishTypeChange(d.key)}
              className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold leading-none transition ${
                active
                  ? "border-brand bg-brand text-white shadow-[0_6px_16px_rgba(249,115,22,0.3)]"
                  : "border-brand-soft bg-white text-ink-soft hover:border-brand hover:text-brand"
              }`}
            >
              <span className="leading-none">{d.label}</span>
              <span
                className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[0.7rem] leading-none ${
                  active ? "bg-white/25 text-white" : "bg-brand-soft/60 text-brand-deep"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {filteredProducts.slice(0, 8).map((p, i) => (
          <div
            key={p.id}
            className="group flex flex-col overflow-hidden rounded-3xl bg-white shadow-[0_8px_24px_rgba(249,115,22,0.10)] ring-1 ring-brand-soft/40 transition hover:-translate-y-1.5 hover:shadow-[0_20px_44px_rgba(249,115,22,0.22)]"
          >
            <div className="overflow-hidden">
              <ImageWithFallback
                src={p.image_url}
                alt={p.name}
                icon={UtensilsCrossed}
                loading={i < 4 ? "eager" : "lazy"}
                width={280}
                height={160}
                className="h-40 w-full object-cover transition duration-500 group-hover:scale-110"
              />
            </div>
            <div className="flex flex-1 flex-col p-4">
              <h3 className="truncate font-display text-[0.98rem] font-extrabold text-ink">
                {p.name}
              </h3>
              <p className="mt-1 mb-3 flex-1 truncate text-xs text-ink-soft">
                {p.restaurants?.name}
              </p>
              <div className="flex items-center justify-between">
                <span className="font-display text-base font-extrabold text-brand-deep">
                  {formatHTG(Number(p.price))}
                </span>
                <Button
                  size="icon-sm"
                  className="hover:scale-110"
                  onClick={() => {
                    const res = add({
                      productId: p.id,
                      restaurantId: p.restaurant_id,
                      restaurantName: p.restaurants?.name ?? "",
                      name: p.name,
                      price: Number(p.price),
                      imageUrl: p.image_url,
                    });
                    if (res === "replaced") toast.info("Panye w a ranplase — restoran diferan");
                    else toast.success(`${p.name} ajoute nan panye`);
                  }}
                  aria-label="Ajoute nan panye"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
