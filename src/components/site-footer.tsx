import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  const navLinks = [
    { to: "/", label: "Akèy" },
    { to: "/restaurants", label: "Restoran" },
    { to: "/orders", label: "Kòmand mwen" },
    { to: "/profile", label: "Pwofil" },
    { to: "/auth", label: "Konekte" },
  ] as const;

  return (
    <footer className="mt-16 bg-white text-brand border-t border-brand/20">
      <div className="mx-auto grid max-w-[1100px] gap-8 px-5 py-10 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <div className="font-display text-xl font-extrabold text-brand">
            NK <span className="text-brand/80">Delivery</span>
          </div>
          <p className="mt-2 max-w-[40ch] text-sm text-brand/85">
            Manje lakay, livre lakay ou. Sèvis livrezon manje nan Gonaïves.
          </p>
        </div>
        <nav aria-label="Navigasyon footer" className="flex flex-col gap-2 text-sm">
          <span className="font-semibold uppercase tracking-wide text-brand/70 text-xs">
            Navigasyon
          </span>
          {navLinks.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="inline-block w-fit rounded py-1 text-brand hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-2">
          <span className="font-semibold uppercase tracking-wide text-brand/70 text-xs">
            Peman
          </span>
          <div className="flex flex-wrap gap-2">
          {["MonCash", "NatCash", "Visa", "Mastercard", "Kach"].map((t) => (
            <span
              key={t}
              className="rounded-full border border-brand/40 bg-brand/5 px-3 py-1 text-xs text-brand"
            >
              {t}
            </span>
          ))}
          </div>
        </div>
      </div>
      <div className="border-t border-brand/20 bg-white px-5 py-4 text-center text-xs text-brand">
        © {new Date().getFullYear()} NK Delivery — Tout dwa rezève
      </div>
    </footer>
  );
}