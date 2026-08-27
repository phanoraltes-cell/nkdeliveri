import { motion } from "framer-motion";
import { Layers, Timer, ShieldCheck, Headphones } from "lucide-react";

// -v2 filename (not a reused "Mockup.png"): the runtime CacheFirst rule in
// src/sw.ts caches same-URL static assets for up to 30 days with zero
// content-revision awareness, and this file is deliberately excluded from
// the revisioned precache manifest (see vite.config.ts's globIgnores, kept
// out on purpose for its own lazy-loading reasons). Any browser that had
// already cached "/Mockup.png" under its old content keeps serving those
// stale bytes indefinitely, network or no network — the exact bug
// hero-livreur-v2.png's own comment documents fixing the same way. A new
// filename is a guaranteed cache MISS for every client regardless of SW
// state, independent of the runtime rule's revision-blindness.
const phoneMockup = "/app-mockup-v2.png";

const APP_BENEFITS = [
  { icon: Layers, title: "Plis chwa", desc: "Yon gwo seleksyon restoran ak plat pou tout gou." },
  { icon: Timer, title: "Livrezon rapid", desc: "Nou garanti livrezon nan mwens pase 45 minit." },
  {
    icon: ShieldCheck,
    title: "Peman sekirite",
    desc: "Peye fasil ak MonCash, NatCash oswa lajan kach.",
  },
  { icon: Headphones, title: "Sipò 24/7", desc: "Nou la pou ede w nenpòt lè w bezwen nou." },
];

/** Home page's "Tout sa w bezwen nan yon sèl aplikasyon web" benefits + phone mockup section. */
export function AppBenefitsSection() {
  return (
    <section className="mx-auto max-w-[1200px] px-5 pb-14">
      <div className="grid items-center gap-10 rounded-[32px] bg-white p-8 shadow-[0_10px_40px_rgba(249,115,22,0.08)] ring-1 ring-brand-soft/40 md:grid-cols-2 md:p-12">
        <div>
          <h2 className="mb-8 font-display text-[clamp(1.6rem,2.8vw,2.2rem)] font-extrabold leading-tight">
            Tout sa w bezwen,
            <br />
            <span className="text-brand">nan yon sèl aplikasyon web</span>
          </h2>
          <div className="grid gap-6 sm:grid-cols-2">
            {APP_BENEFITS.map((b) => (
              <div key={b.title} className="flex gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft/50 text-brand">
                  <b.icon className="h-6 w-6" />
                </span>
                <div>
                  <h3 className="mb-1 font-display text-base font-extrabold text-ink">{b.title}</h3>
                  <p className="text-sm text-ink-soft">{b.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <motion.div
          className="flex justify-center"
          animate={{ y: [0, -10, 0] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        >
          <img
            src={phoneMockup}
            alt="Aplikasyon NK Deliveri"
            loading="lazy"
            // Actual file is 873×1802 — was declared as 833×1725 (a stale
            // approximation from before this asset's last swap), which
            // gives the browser a slightly wrong aspect ratio to reserve
            // before the image loads and causes a small layout shift on
            // load. Corrected to the real dimensions.
            width={873}
            height={1802}
            className="max-h-[520px] w-auto object-contain drop-shadow-[0_30px_40px_rgba(249,115,22,0.25)]"
          />
        </motion.div>
      </div>
    </section>
  );
}
