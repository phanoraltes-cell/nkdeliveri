import { motion } from "framer-motion";
import { Store, UtensilsCrossed, Wallet, Bike } from "lucide-react";

const HOW_STEPS = [
  { icon: Store, title: "Chwazi restoran", desc: "Dekouvri meyè restoran nan zòn ou." },
  {
    icon: UtensilsCrossed,
    title: "Chwazi sa w vle",
    desc: "Ajoute plat ou renmen yo nan panyen an.",
  },
  { icon: Wallet, title: "Peye fasil", desc: "Peye an sekirite ak MonCash oswa NatCash." },
  { icon: Bike, title: "Resevwa l rapid", desc: "Livrezon cho e rapid jis lakay ou." },
];

/** Home page's "Kijan li travay" 4-step explainer. */
export function HowItWorksSection() {
  return (
    <section className="mx-auto max-w-[1200px] px-5 py-14">
      <h2 className="mb-10 text-center font-display text-[clamp(1.7rem,3vw,2.4rem)] font-extrabold tracking-tight">
        Kijan li <span className="text-brand">travay</span> ?
      </h2>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {HOW_STEPS.map((s, i) => (
          <motion.div
            key={s.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: i * 0.08 }}
            className="group relative rounded-3xl bg-white p-6 text-center shadow-[0_8px_28px_rgba(249,115,22,0.08)] ring-1 ring-brand-soft/40 transition hover:-translate-y-1.5 hover:shadow-[0_20px_40px_rgba(249,115,22,0.18)]"
          >
            <span className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full bg-brand text-xs font-extrabold text-white">
              {i + 1}
            </span>
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-soft/50 text-brand transition group-hover:scale-110 group-hover:bg-brand group-hover:text-white">
              <s.icon className="h-8 w-8" />
            </div>
            <h3 className="mb-1.5 font-display text-lg font-extrabold text-ink">{s.title}</h3>
            <p className="text-sm text-ink-soft">{s.desc}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
