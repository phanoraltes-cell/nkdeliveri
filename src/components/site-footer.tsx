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
    <footer className="mt-16 bg-brand text-white">
      <div className="mx-auto grid max-w-[1100px] gap-8 px-5 py-10 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <div className="font-display text-xl font-extrabold text-white">
            NK <span className="text-cream">Delivery</span>
          </div>
          <p className="mt-2 max-w-[40ch] text-sm text-white/85">
            Manje lakay, livre lakay ou. Sèvis livrezon manje nan Gonaïves.
          </p>
        </div>
        <nav aria-label="Navigasyon footer" className="flex flex-col gap-2 text-sm">
          <span className="font-semibold uppercase tracking-wide text-white/70 text-xs">
            Navigasyon
          </span>
          {navLinks.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="inline-block w-fit rounded py-1 text-white hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-2">
          <span className="font-semibold uppercase tracking-wide text-white/70 text-xs">
            Peman
          </span>
          <div className="flex flex-wrap gap-2">
          {["MonCash", "NatCash", "Visa", "Mastercard", "Kach"].map((t) => (
            <span
              key={t}
              className="rounded-full border border-white/40 bg-white/10 px-3 py-1 text-xs text-white"
            >
              {t}
            </span>
          ))}
          </div>
        </div>
      </div>
      <div className="border-t border-white/20 px-5 py-4 text-center text-xs text-white/80">
        © {new Date().getFullYear()} NK Delivery — Tout dwa rezève
      </div>
    </footer>
  );
}