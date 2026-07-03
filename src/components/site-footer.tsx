export function SiteFooter() {
  return (
    <footer className="mt-16 bg-white text-brand border-t border-brand/20">
      <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-8 px-5 py-10">
        <div>
          <div className="font-display text-xl font-extrabold text-brand">
            NK <span className="text-brand/80">Delivery</span>
          </div>
          <p className="mt-2 max-w-[40ch] text-sm text-brand/85">
            Manje lakay, livre lakay ou. Sèvis livrezon manje nan Gonaïves.
          </p>
        </div>
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
      <div className="border-t border-brand/20 bg-white px-5 py-4 text-center text-xs text-brand">
        © {new Date().getFullYear()} NK Delivery — Tout dwa rezève
      </div>
    </footer>
  );
}