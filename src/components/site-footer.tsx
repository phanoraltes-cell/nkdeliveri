import { Link } from "@tanstack/react-router";
import { Banknote } from "lucide-react";
import { SOCIAL_LINKS } from "@/lib/site-config";
import { useAuth } from "@/hooks/useAuth";

export function SiteFooter() {
  // Refonte Frontend Premium, Phase 10 (P10) — this footer is only ever
  // rendered on public routes (never inside /dashboard/*), so it only
  // needs to distinguish signed-in from signed-out, the same split
  // site-header.tsx already handles with the same hook — not one branch
  // per role. Before this, "Konekte" was shown unconditionally, even to a
  // user already signed in one scroll away from a header that got this
  // right.
  const { user } = useAuth();
  const navLinks = [
    { to: "/", label: "Akèy" },
    { to: "/restaurants", label: "Restoran" },
    { to: "/orders", label: "Kòmand mwen" },
    { to: "/profile", label: "Pwofil" },
    user
      ? ({ to: "/dashboard", label: "Dashboard" } as const)
      : ({ to: "/auth", label: "Konekte" } as const),
  ] as const;

  const companyLinks = [
    { to: "/about", label: "Apwopo" },
    { to: "/contact", label: "Kontak" },
    { to: "/faq", label: "FAQ" },
    { to: "/auth/register", label: "Vin yon livrè" },
  ] as const;

  const legalLinks = [
    { to: "/terms", label: "Kondisyon itilizasyon" },
    { to: "/privacy", label: "Konfidansyalite" },
  ] as const;

  const payments = [
    { name: "MonCash", kind: "image", src: "/moncash-logo-hero.png" },
    { name: "NatCash", kind: "image", src: "/natcash-logo-new.png" },
    { name: "Kach", kind: "icon" },
    // Kat Kredi (Stripe) — same list, same treatment as the other 3
    // enabled methods; added once payment-card-logo-integration
    // confirmed it's genuinely enabled (payment_provider_settings),
    // not just visible-but-disabled.
    { name: "Kat Kredi", kind: "image", src: "/katkredi.png" },
  ] as const;

  return (
    <footer className="mt-16 bg-brand text-white">
      <div className="mx-auto grid max-w-[1100px] gap-8 px-5 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2.5">
            <img
              src="/nk-logo.png"
              alt="NK Deliveri"
              width={36}
              height={36}
              loading="lazy"
              className="h-9 w-9 rounded-full bg-white object-contain p-0.5"
            />
            <div className="font-display text-xl font-extrabold text-white">
              NK <span className="text-cream">Deliveri</span>
            </div>
          </div>
          <p className="mt-2 max-w-[40ch] text-sm text-white/85">
            Manje lakay, livre lakay ou. Sèvis livrezon manje nan Gonaïves.
          </p>
          {SOCIAL_LINKS.length > 0 && (
            <div className="mt-3 flex gap-3">
              {SOCIAL_LINKS.map((s) => (
                <a
                  key={s.url}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-white/85 hover:text-white hover:underline"
                >
                  {s.label}
                </a>
              ))}
            </div>
          )}
        </div>
        <nav aria-label="Navigasyon footer" className="flex flex-col gap-2 text-sm">
          <span className="font-semibold uppercase tracking-wide text-ink text-xs">Navigasyon</span>
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
        <nav aria-label="Konpayi" className="flex flex-col gap-2 text-sm">
          <span className="font-semibold uppercase tracking-wide text-ink text-xs">Konpayi</span>
          {companyLinks.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="inline-block w-fit rounded py-1 text-white hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-4">
          <nav aria-label="Legal" className="flex flex-col gap-2 text-sm">
            <span className="font-semibold uppercase tracking-wide text-ink text-xs">Legal</span>
            {legalLinks.map((l) => (
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
            <span className="font-semibold uppercase tracking-wide text-ink text-xs">Peman</span>
            <div className="flex flex-wrap gap-2">
              {payments.map((p) =>
                p.kind === "image" ? (
                  <img
                    key={p.name}
                    src={p.src}
                    alt={p.name}
                    title={p.name}
                    width={40}
                    height={40}
                    loading="lazy"
                    className="h-10 w-10 rounded-xl object-cover shadow-brand-xs"
                  />
                ) : (
                  <span
                    key={p.name}
                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-white px-3 shadow-brand-xs"
                    title={p.name}
                  >
                    <Banknote className="h-5 w-5 text-brand-deep" />
                    <span className="text-sm font-bold text-ink">{p.name}</span>
                  </span>
                ),
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="border-t border-white/20 px-5 py-4 text-center text-xs text-ink">
        © {new Date().getFullYear()} NK Deliveri — Tout dwa rezève
      </div>
    </footer>
  );
}
