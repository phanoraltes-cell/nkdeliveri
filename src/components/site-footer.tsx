import { Link } from "@tanstack/react-router";
import { Banknote, Facebook, Instagram } from "lucide-react";
import { SOCIAL_LINKS } from "@/lib/site-config";
import { useAuth } from "@/hooks/useAuth";

// lucide-react has no TikTok mark (it only ships Feather's original small
// social set — Facebook/Instagram/Twitter/Linkedin/Youtube, confirmed by
// checking its exports) — hand-rolled here rather than pulling in a whole
// brand-icon package (react-icons/simple-icons) for one glyph, matching
// Faz 9's dependency-conscious posture. `currentColor` fill so it inherits
// the same color treatment as the two lucide icons next to it.
function TiktokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M16.6 5.82c-.7-.77-1.09-1.77-1.09-2.82h-3.02v13.44c0 1.5-1.22 2.72-2.72 2.72a2.72 2.72 0 0 1 0-5.44c.28 0 .55.04.8.12V10.7a5.6 5.6 0 0 0-.8-.06A5.76 5.76 0 0 0 4 16.4a5.76 5.76 0 0 0 5.77 5.76 5.76 5.76 0 0 0 5.76-5.76V9.01a8.7 8.7 0 0 0 5.09 1.63V7.63a5.83 5.83 0 0 1-4.02-1.81z" />
    </svg>
  );
}

const SOCIAL_ICONS = { facebook: Facebook, instagram: Instagram, tiktok: TiktokIcon } as const;

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
            {/* Icon grown ~33% (36→48px) — slightly larger than the
                navbar's own icon per the request ("footer icon nan ka yon
                ti jan pi gwo"), text branding next to it untouched. */}
            <img
              src="/nk-logo.png"
              alt="NK Deliveri"
              width={48}
              height={48}
              loading="lazy"
              className="h-12 w-12 rounded-full bg-white object-contain p-0.5"
            />
            <div className="font-display text-xl font-extrabold text-white">
              NK <span className="text-cream">Deliveri</span>
            </div>
          </div>
          <p className="mt-2 max-w-[40ch] text-sm text-white/85">
            Manje lakay, livre lakay ou. Sèvis livrezon manje nan Gonaïves.
          </p>
          {SOCIAL_LINKS.length > 0 && (
            <div className="mt-3 flex gap-2.5">
              {SOCIAL_LINKS.map((s) => {
                const Icon = SOCIAL_ICONS[s.icon];
                // No real account URL yet (site-config.ts) — show the icon
                // now as requested, but as an inert, dimmed, non-clickable
                // marker rather than a link to nowhere. Becomes a real
                // link automatically the moment `url` is filled in, no
                // further change needed here.
                return s.url ? (
                  <a
                    key={s.label}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={s.label}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
                  >
                    <Icon className="h-4.5 w-4.5" />
                  </a>
                ) : (
                  <span
                    key={s.label}
                    aria-hidden="true"
                    title={`${s.label} — byento`}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/45"
                  >
                    <Icon className="h-4.5 w-4.5" />
                  </span>
                );
              })}
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

      {/* Seksyon "Patnè Ofisyèl" la retire nan footer a espre (demand
          itilizatè) — li rete SÈLMAN sou paj akèy la kounye a (apre
          NewsletterSection/scooter, wè partners-section.tsx), pou plis
          vizibilite san repete l sou tout paj sit la. */}

      <div className="border-t border-white/20 px-5 py-4 text-center text-xs text-ink">
        © {new Date().getFullYear()} NK Deliveri — Tout dwa rezève
      </div>
    </footer>
  );
}
