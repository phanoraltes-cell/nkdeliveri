import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { useCart } from "@/hooks/useCart";
import { useFavorites } from "@/hooks/useFavorites";
import { toast } from "sonner";
import { SITE_URL } from "@/lib/site-config";
import { homeDataQuery } from "@/components/home/home-data";
import { HeroSection } from "@/components/home/hero-section";
import { KategoriPlaSection } from "@/components/home/kategori-pla-section";
import { HaitiVideoPopup } from "@/components/home/haiti-video-popup";
import { AdBannerSection } from "@/components/home/ad-banner-section";
import { HowItWorksSection } from "@/components/home/how-it-works-section";
import { RestaurantCtaBanner } from "@/components/home/restaurant-cta-banner";
import { PopularRestaurantsSection } from "@/components/home/popular-restaurants-section";
import { AppBenefitsSection } from "@/components/home/app-benefits-section";
import { PopularDishesSection } from "@/components/home/popular-dishes-section";
import { NewsletterSection } from "@/components/home/newsletter-section";

export const Route = createFileRoute("/")({
  // Title/description/OG already come from the root's defaults — this page
  // only needs to add its own canonical (root deliberately sets none, see
  // __root.tsx, to avoid two conflicting <link rel="canonical"> tags).
  head: () => ({
    links: [{ rel: "canonical", href: SITE_URL }],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(homeDataQuery),
  component: Index,
});

function Index() {
  const { data } = useSuspenseQuery(homeDataQuery);
  const [cuisine, setCuisine] = useState("Tout");
  const [dishType, setDishType] = useState("all");
  const [q, setQ] = useState("");
  const { add } = useCart();
  const { isFavorite, toggleFavorite, isLoggedIn } = useFavorites();
  const nav = useNavigate();

  function onToggleFavorite(e: React.MouseEvent, restaurantId: string) {
    e.preventDefault();
    if (!isLoggedIn) {
      toast.error("Ou dwe konekte pou mete yon restoran an favori");
      nav({ to: "/auth", search: { next: "/" } });
      return;
    }
    toggleFavorite(restaurantId);
  }

  // Kategori Pla cards → reuse the existing dish-type filter that already
  // drives PopularDishesSection below, rather than inventing a new
  // category mechanism. Cards without a real dish_type match pass "all"
  // as an honest reset instead of leaving a stale/unrelated filter
  // active — see kategori-pla-section.tsx's own comment for which 5 of
  // the 10 categories actually have a match today.
  function handleCategoryClick(dishTypeKey: string) {
    setDishType(dishTypeKey);
    document.getElementById("plat-popile")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const restaurants = data.restaurants.filter(
    (r) =>
      (cuisine === "Tout" || r.cuisine === cuisine) &&
      r.name.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />

      <main>
        <HeroSection
          q={q}
          onQChange={setQ}
          onSearch={(e) => {
            e.preventDefault();
            nav({ to: "/restaurants", search: { q } });
          }}
        />

        <KategoriPlaSection onCategoryClick={handleCategoryClick} />

        <AdBannerSection />

        <HowItWorksSection />

        <RestaurantCtaBanner />

        <PopularRestaurantsSection
          restaurants={restaurants}
          cuisine={cuisine}
          onCuisineChange={setCuisine}
          isFavorite={isFavorite}
          onToggleFavorite={onToggleFavorite}
        />

        <AppBenefitsSection />

        <PopularDishesSection
          products={data.products}
          dishType={dishType}
          onDishTypeChange={setDishType}
          add={add}
        />

        <NewsletterSection />
      </main>

      <SiteFooter />

      {/* Home-only — deliberately NOT mounted in __root.tsx, so it can
          never surface over checkout or order tracking mid-order. */}
      <HaitiVideoPopup />
    </div>
  );
}
