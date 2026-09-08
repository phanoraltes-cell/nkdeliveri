import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Megaphone, X, ChevronLeft, ChevronRight, ArrowRight } from "lucide-react";
import { useActivePlacements } from "@/hooks/useActivePlacements";
import { AdMedia } from "@/components/ads/ad-media";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Demand itilizatè apre premye vèsyon an (Tach 5): 3 chanjman konpòtman
// eksplisit — (1) tay redwi, jamè "plen ekran" kèlkeswa rapò dimansyon
// imaj la; (2) afiche a CHAK rafrechisman paj (pa gen limit/kouldaoun ki
// kenbe l kache pandan 24h ankò); (3) plizyè anons popup aktif defile youn
// apre lòt (karousèl) nan MENM modal la olye montre yon sèl.
const POPUP_LIMIT = 6;
const AUTO_ADVANCE_MS = 6000;

// "Jamè pandan checkout/peman/retrè, ni pandan konekte, ni nan dashboard
// admin" (demand eksplisit, Tach 2 — WALLET/DEKÈSMAN/PIBLISITE) — sa a rete
// yon EGZKLIZYON DIRÈK, endepandan de `dashboard_targets`: menm si yon
// popup ta gen 'public' nan sib li, li pa janm parèt sou youn nan chemen sa
// yo. Dashboard admin eksklu paske spesifikasyon an mande sèlman 3 dashboard
// posib (kliyan/restoran/livrè) — pa gen valè "dashboard_admin" nan CHECK
// baz done a menm. "/dashboard/*/payouts" kouvri paj retrè restoran/livrè
// aktyèl yo; yon lòt chemen retrè lajan (Tach 3, kliyan/wallet) ta dwe
// ajoute isit la tou lè li kreye.
function isPopupExcludedRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/checkout") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/dashboard/admin") ||
    pathname.includes("/payouts")
  );
}

// Tach 2 — kontèks popup la deside ki `dashboard_targets` ki aplike.
function popupContext(pathname: string): string {
  if (pathname.startsWith("/dashboard/customer")) return "dashboard_customer";
  if (pathname.startsWith("/dashboard/restaurant")) return "dashboard_restaurant";
  if (pathname.startsWith("/dashboard/driver")) return "dashboard_driver";
  return "public";
}

/**
 * Tach 5 — tip anons "popup", nouvo vèsyon apre demand itilizatè a: yon
 * modal KONPAKT (jamè plen ekran, menm ak yon imaj vètikal) ki parèt SOU
 * CHAK rafrechisman paj (okenn kouldaoun localStorage ankò — `shownRef`
 * anpeche sèlman yon REPETISYON pandan menm chajman app la, li pa pèsiste
 * apre yon vrè rafrechisman/F5, ki remonte tout React eta a soti nan
 * zewo). Si plizyè anons popup aktif, yo defile younn apre lòt (flèch +
 * pwen + otomatik apre 6s) nan menm modal la; bouton X la fèmen TOUT
 * karousèl la, pa sèlman anons kap afiche kounye a. Focus-trap/Esc/wòl
 * ARIA "dialog" se Radix Dialog (deja itilize toupatou nan sit la).
 */
export function PopupAdModal() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const placements = useActivePlacements("popup", POPUP_LIMIT, popupContext(pathname));
  const ads = placements.data ?? [];
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  // `useRef` (pa `useState`) espre: sa a pa dwe deklannche yon re-render
  // tèt li, sèlman anpeche `useEffect` anba a re-deklannche modal la yon
  // dezyèm fwa pandan MENM chajman paj la (egzanp: `ads` rechaje an
  // background epi chanje referans). Yon vrè rafrechisman (F5) kreye yon
  // nouvo enstans kòmpozan an antyèman — `shownRef.current` re-kòmanse a
  // `false` otomatikman, se sa ki fè popup la parèt "a chak rafrechisman"
  // jan sa mande a, san okenn stokaj pèsistan (localStorage/cookie).
  const shownRef = useRef(false);

  useEffect(() => {
    if (isPopupExcludedRoute(pathname)) {
      setOpen(false);
      return;
    }
    if (!ads.length || shownRef.current) return;
    // Ti delè (1.2s) pou pa fè modal la parèt egzakteman nan menm segond
    // ak premye chajman paj la — kite kontni reyèl la parèt dabò.
    const timer = setTimeout(() => {
      shownRef.current = true;
      setIndex(0);
      setOpen(true);
    }, 1200);
    return () => clearTimeout(timer);
  }, [ads.length, pathname]);

  // Defilman otomatik karousèl la pandan modal la louvri, sèlman si gen
  // plis pase yon anons — yon sèl anons pa bezwen tan.
  useEffect(() => {
    if (!open || ads.length <= 1) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % ads.length), AUTO_ADVANCE_MS);
    return () => clearInterval(t);
  }, [open, ads.length]);

  function close() {
    setOpen(false);
  }
  function next() {
    setIndex((i) => (i + 1) % ads.length);
  }
  function prev() {
    setIndex((i) => (i - 1 + ads.length) % ads.length);
  }

  if (!ads.length) return null;
  const ad = ads[Math.min(index, ads.length - 1)];
  const hasMedia = !!(ad.media_url || ad.image_url || ad.restaurant_cover_url);
  const href =
    ad.link_url ?? (ad.restaurant_slug ? `/restaurants/${ad.restaurant_slug}` : undefined);
  // `cta_label` — chan ki egziste deja nan `sponsored_placements` (jere pa
  // `create_sponsored_placement_secure`/`update_sponsored_placement_secure`,
  // wè types.ts) men ki pa gen editè admin ankò — li ka rete vid pou
  // pifò anons, "Wè plis" la se yon repli, pa yon valè envante.
  const ctaLabel = ad.cta_label || "Wè plis";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Radix rele sa a ak `false` pou Esc AK klike deyò — menm chemen
        // fèmti egzat ak bouton X pèsonalize a (pi ba), pou konpòtman an
        // rete konsistan kèlkeswa mwayen itilizatè a chwazi.
        if (!next) close();
      }}
    >
      {/* Redesign "Premium Sponsored Advertisement Card" (demand itilizatè)
          — sèlman prezantasyon/UI: menm Radix Dialog (backdrop dim+blur,
          animasyon fade+zoom, focus-trap, Esc, aria-labelledby/describedby
          otomatik via DialogTitle/DialogDescription) ak menm konpòtman
          karousèl/fèmti/CTA ki te la deja, jis abiye pi byen.
          Mobil (<768px): kat konpakt anpile (imaj → kontni), `w-[calc(100%-2rem)]`
          + `max-h-[88vh] overflow-y-auto` anpeche l janm depase viewport la.
          Desktop (≥768px): 2 kolòn (kontni agoch, imaj adwat), `max-w-[760px]`
          pou l gen "breathing room" san l pran tout ekran an. */}
      <DialogContent
        className={cn(
          "w-[calc(100%-2rem)] max-w-sm max-h-[88vh] gap-0 overflow-y-auto rounded-[22px] border-brand-soft/40 bg-card p-0 shadow-brand-lg [&>button]:hidden",
          "md:w-[calc(100%-3rem)] md:max-w-[760px] md:rounded-[28px]",
        )}
      >
        {/* Bouton fèmen pèsonalize — ranplase X default Radix la (ki te ka
            pèdi nan yon imaj plen kontras) ak youn ki toujou vizib (fon
            blan translusid, lonbraj, ti agrandisman nan hover), pozisyone
            anlè imaj la kèlkeswa koulè l. Anvlopi nan yon <div> (pa yon
            <button> dirèk anba DialogContent) espre: className
            `[&>button]:hidden` pi wo a kache SÈLMAN X default Radix la (ki
            se yon <button> dirèk anba menm Content lan) — san `<div>` sa
            a, règ la ta kache bouton pèsonalize sa a tou, paske toude ta
            "dirèk anba" menm eleman paran an. Konpòtman fèmti a rete
            IDANTIK (menm fonksyon `close()`) — sèlman abiman an chanje. */}
        <div>
          <button
            type="button"
            onClick={close}
            aria-label="Fèmen"
            className="absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-ink shadow-md backdrop-blur transition duration-200 hover:scale-105 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          className={cn(
            "flex flex-col",
            // Sèlman lè gen medya: grid 2-kolòn depi 768px (kontni ~56%,
            // imaj ~44%). San medya, yon sèl kolòn tou depi desktop.
            hasMedia ? "md:grid md:grid-cols-[1fr_44%] md:items-stretch" : "md:block",
          )}
        >
          {hasMedia && (
            // Rapò dimansyon FIKS (16/9) — pa rapò dimansyon dinamik imaj
            // la (se egzakteman sa ki te lakòz "plen ekran" a sou yon imaj
            // vètikal). `object-cover` ranpli bwat la san l pa deforme,
            // sèlman koupe depasman an — tretman estanda pou yon "hero"
            // imaj piblisite premium. Sou desktop, `md:aspect-auto` +
            // `absolute inset-0` kite grid la (ki egalize wotè kolòn yo
            // otomatikman) deside wotè a, olye rapò 16/9 la.
            <div className="relative order-1 aspect-[16/9] w-full overflow-hidden bg-ink/5 md:order-2 md:aspect-auto">
              <AdMedia
                ad={{ ...ad, image_url: ad.image_url ?? ad.restaurant_cover_url }}
                icon={Megaphone}
                loading="eager"
                width={ad.media_width ?? 600}
                height={ad.media_height ?? 450}
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
          )}

          <div
            className={cn(
              "order-2 flex flex-col p-5 sm:p-6",
              hasMedia && "md:order-1 md:justify-center md:p-8",
            )}
          >
            <span className="mb-2 inline-flex w-fit items-center gap-1 rounded-full bg-brand-soft/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-ink">
              <Megaphone className="h-3 w-3" aria-hidden="true" />
              Piblisite
            </span>
            <DialogTitle className="text-xl font-extrabold leading-[1.15] tracking-tight text-ink sm:text-2xl md:text-[1.85rem]">
              {ad.title}
            </DialogTitle>
            {ad.description && (
              <DialogDescription className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-soft sm:text-[15px] md:line-clamp-4 md:text-base">
                {ad.description}
              </DialogDescription>
            )}
            {href && (
              <a
                href={href}
                onClick={close}
                className="mt-5 inline-flex h-12 w-full items-center justify-center gap-1.5 rounded-full bg-brand-deep px-6 text-sm font-bold text-white shadow-brand-sm transition duration-200 hover:-translate-y-0.5 hover:bg-brand-deep-hover sm:h-14 sm:text-base"
              >
                {ctaLabel}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
            )}

            {/* Karousèl — sèlman si plizyè anons popup aktif anmenm tan.
                Menm lojik (index, otomatik 6s) ak anvan, sèlman sib tap
                pi gwo (36px) pou pi bon aksesibilite tactile. */}
            {ads.length > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={prev}
                  aria-label="Anons anvan"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition hover:bg-brand-soft/40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-1.5">
                  {ads.map((a, i) => (
                    <span
                      key={a.id}
                      aria-hidden="true"
                      className={`h-1.5 rounded-full transition-all ${
                        i === index ? "w-4 bg-brand" : "w-1.5 bg-brand-soft"
                      }`}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={next}
                  aria-label="Pwochen anons"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition hover:bg-brand-soft/40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
