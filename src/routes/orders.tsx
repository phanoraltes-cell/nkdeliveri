import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export const Route = createFileRoute("/orders")({
  head: () => ({ meta: [{ title: "Kòmand mwen — NK Delivery" }] }),
  component: Orders,
});

function Orders() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <div className="mx-auto max-w-[640px] px-5 py-12">
        <h1 className="mb-3 font-display text-2xl font-extrabold">Kòmand mwen</h1>
        <div className="rounded-[18px] bg-white p-8 text-center text-ink-soft shadow-[0_8px_24px_rgba(194,90,5,0.10)]">
          <p>Ou poko gen okenn kòmand.</p>
          <Link to="/" className="mt-3 inline-block font-bold text-brand-deep hover:underline">
            Kòmanse kòmande →
          </Link>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}