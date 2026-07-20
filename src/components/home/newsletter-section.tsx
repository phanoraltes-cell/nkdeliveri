import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const scooterImg = "/scooter.jpg";

/** Home page's newsletter signup card, with its own subscribe-form state and Supabase insert. */
export function NewsletterSection() {
  const [newsletterEmail, setNewsletterEmail] = useState("");
  const [subscribing, setSubscribing] = useState(false);

  async function subscribeNewsletter(e: React.FormEvent) {
    e.preventDefault();
    setSubscribing(true);
    try {
      const { error } = await supabase
        .from("newsletter_subscribers")
        .insert({ email: newsletterEmail.trim().toLowerCase() });
      if (error) {
        if (error.code === "23505") {
          toast.info("Ou deja enskri!");
        } else {
          throw error;
        }
      } else {
        toast.success("Mèsi! Ou enskri.");
      }
      setNewsletterEmail("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erè pandan enskripsyon an");
    } finally {
      setSubscribing(false);
    }
  }

  return (
    <section className="mx-auto max-w-[1200px] px-5 pb-16">
      <div className="grid overflow-hidden rounded-[32px] bg-brand text-white shadow-[0_20px_60px_rgba(249,115,22,0.35)] md:grid-cols-[1.3fr_1fr]">
        <div className="p-8 md:p-12">
          <h2 className="mb-2 font-display text-[clamp(1.5rem,2.6vw,2rem)] font-extrabold">
            Rete konekte ak NK Deliveri+
          </h2>
          <p className="mb-6 text-white/90">
            Enskri pou resevwa promosyon, nouvote ak avantaj espesyal.
          </p>
          <form
            onSubmit={subscribeNewsletter}
            className="flex max-w-[460px] items-center rounded-full bg-white p-1.5"
          >
            <input
              type="email"
              required
              value={newsletterEmail}
              onChange={(e) => setNewsletterEmail(e.target.value)}
              placeholder="Antre imèl ou"
              aria-label="Antre imèl ou"
              className="min-w-0 flex-1 rounded-full bg-transparent px-4 py-2.5 text-sm text-ink outline-none placeholder:text-ink-soft"
            />
            <button
              disabled={subscribing}
              className="shrink-0 rounded-full bg-brand-deep px-6 py-2.5 text-sm font-extrabold text-white transition hover:bg-ink disabled:opacity-60"
            >
              {subscribing ? "…" : "Enskri"}
            </button>
          </form>
        </div>
        <div className="relative">
          <img
            src={scooterImg}
            alt="Scooter NK Deliveri"
            loading="lazy"
            width={1024}
            height={768}
            className="h-full w-full object-cover md:absolute md:inset-0"
          />
        </div>
      </div>
    </section>
  );
}
