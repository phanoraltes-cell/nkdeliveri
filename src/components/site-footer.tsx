import { Link } from "@tanstack/react-router";
import { Banknote } from "lucide-react";
import { SOCIAL_LINKS } from "@/lib/site-config";

export function SiteFooter() {
  const navLinks = [
    { to: "/", label: "Akèy" },
    { to: "/restaurants", label: "Restoran" },
    { to: "/orders", label: "Kòmand mwen" },
    { to: "/profile", label: "Pwofil" },
    { to: "/auth", label: "Konekte" },
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
        <nav aria-label="Konpayi" className="flex flex-col gap-2 text-sm">
          <span className="font-semibold uppercase tracking-wide text-white/70 text-xs">
            Konpayi
          </span>
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
            <span className="font-semibold uppercase tracking-wide text-white/70 text-xs">
              Legal
            </span>
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
            <span className="font-semibold uppercase tracking-wide text-white/70 text-xs">
              Peman
            </span>
            <div className="flex flex-wrap gap-2">
              {payments.map((p) => (
                <span
                  key={p.name}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-white px-3 shadow-brand-xs"
                  title={p.name}
                >
                  {p.kind === "image" && (
                    <img
                      src={p.src}
                      alt={p.name}
                      width={64}
                      height={28}
                      loading="lazy"
                      className="h-7 w-16 object-contain"
                    />
                  )}
                  {p.kind === "icon" && (
                    <>
                      <Banknote className="h-5 w-5 text-brand-deep" />
                      <span className="text-sm font-bold text-ink">{p.name}</span>
                    </>
                  )}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="border-t border-white/20 px-5 py-4 text-center text-xs text-white/80">
        © {new Date().getFullYear()} NK Deliveri — Tout dwa rezève
      </div>
    </footer>
  );
}
