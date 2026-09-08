import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

const chefImg = "/chef.jpg";

/** Home page's "Ou restoran?" banner inviting restaurant owners to sign up. */
export function RestaurantCtaBanner() {
  return (
    <section className="mx-auto max-w-[1200px] px-5 pb-14">
      <div className="relative grid overflow-hidden rounded-[32px] bg-brand-deep text-white shadow-[0_20px_60px_rgba(249,115,22,0.35)] md:grid-cols-[1.4fr_1fr]">
        <div className="relative z-10 p-8 md:p-12">
          <h2 className="mb-3 font-display text-[clamp(1.6rem,2.8vw,2.2rem)] font-extrabold leading-tight">
            Ou restoran ?
          </h2>
          <p className="mb-6 max-w-[38ch] text-white/90">
            Fè biznis ou grandi ak NK Deliveri epi rive jwenn plis kliyan chak jou.
          </p>
          <Link
            to="/auth"
            className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-extrabold text-brand-deep shadow-lg transition hover:scale-[1.03] hover:bg-cream"
          >
            Enskri restoran ou <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="relative">
          <img
            src={chefImg}
            alt="Chef NK Deliveri"
            loading="lazy"
            width={1024}
            height={768}
            className="h-full w-full object-cover object-center md:absolute md:inset-0"
          />
        </div>
      </div>
    </section>
  );
}
