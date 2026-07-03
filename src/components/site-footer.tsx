export function SiteFooter() {
  return (
    <footer className="mt-16 bg-brand text-white">
      <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-8 px-5 py-10">
        <div>
          <div className="font-display text-xl font-extrabold text-white">
            NK <span className="text-cream">Delivery</span>
          </div>
          <p className="mt-2 max-w-[40ch] text-sm text-white/85">
            Manje lakay, livre lakay ou. Sèvis livrezon manje nan Gonaïves.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {["MonCash", "NatCash", "Visa", "Mastercard", "Kach"].map((t) => (
            <span
              key={t}
              className="rounded-full border border-white/40 bg-white/10 px-3 py-1 text-xs"
            >
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className="border-t border-white/20 px-5 py-4 text-center text-xs text-white/80">
        © {new Date().getFullYear()} NK Delivery — Tout dwa rezève
      </div>
    </footer>
  );
}