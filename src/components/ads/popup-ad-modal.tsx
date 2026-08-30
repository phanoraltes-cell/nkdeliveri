import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Megaphone, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useActivePlacements } from "@/hooks/useActivePlacements";
import { AdMedia } from "@/components/ads/ad-media";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

// Demand itilizatè apre premye vèsyon an (Tach 5): 3 chanjman konpòtman
// eksplisit — (1) tay redwi, jamè "plen ekran" kèlkeswa rapò dimansyon
// imaj la; (2) afiche a CHAK rafrechisman paj (pa gen limit/kouldaoun ki
// kenbe l kache pandan 24h ankò); (3) plizyè anons popup aktif defile youn
// apre lòt (karousèl) nan MENM modal la olye montre yon sèl.
const POPUP_LIMIT = 6;
const AUTO_ADVANCE_MS = 6000;

// "Jamè pandan checkout" (demand eksplisit) — ak /auth ak /dashboard pou
// menm rezon (yon modal ki mande aksyon pa dwe janm parazite yon flux
// kritik: peman, konekte, oswa jesyon kont/restoran/livrezon).
function isPopupExcludedRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/checkout") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/dashboard")
  );
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
  const placements = useActivePlacements("popup", POPUP_LIMIT);
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
      {/* Tay KONPAKT eksplisit — `w-[calc(100%-2rem)]` garanti omwen 1rem
          respire chak bò sou yon ti ekran telefòn, `max-w-sm` (384px)
          plafonn li sou desktop, `max-h-[80vh]` + `overflow-y-auto`
          anpeche l janm depase wotè ekran an kèlkeswa longè deskripsyon
          an. Ansyen vèsyon an te kite imaj la deside wotè kontenè a atravè
          `aspectRatio` sou LARGÈ w-full (100vw sou mobil) — pou yon imaj
          vètikal sa te vin "plen ekran". Kounye a se lekontrè: imaj la
          BONE a `h-40` FIKS (pi ba), li redwi pwòp li anndan bwat sa a
          (object-contain, jamè koupe) olye kontenè a grandi pou li. */}
      <DialogContent className="w-[calc(100%-2rem)] max-w-sm max-h-[80vh] gap-0 overflow-y-auto rounded-3xl p-0 [&>button]:hidden">
        {/* Bouton fèmen pèsonalize — ranplase X default Radix la (ki te ka
            pèdi nan yon imaj plen kontras) ak youn ki toujou vizib (fon
            blan solid, lonbraj), pozisyone anlè imaj la kèlkeswa koulè l.
            Anvlopi nan yon <div> (pa yon <button> dirèk anba DialogContent)
            espre: className `[&>button]:hidden` pi wo a kache SÈLMAN X
            default Radix la (ki se yon <button> dirèk anba menm Content
            lan) — san `<div>` sa a, règ la ta kache bouton pèsonalize sa a
            tou, paske toude ta "dirèk anba" menm eleman paran an. */}
        <div>
          <button
            type="button"
            onClick={close}
            aria-label="Fèmen"
            className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white text-ink shadow-md transition hover:bg-ink/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {hasMedia && (
          // Wotè FIKS (pa yon rapò dimansyon dinamik jan lòt anons yo
          // itilize, Tach 4) — espre pou popup la, paske se egzakteman sa
          // ki te lakòz pwoblèm nan: yon imaj vètikal ki gen kontrent
          // rapò dimansyon SOU LARGÈ w-full (100vw sou mobil) ta pwodwi
          // yon wotè imans. Yon bwat fiks + object-contain garanti popup
          // la rete konpakt kèlkeswa fòm/oryantasyon imaj admin an telechaje.
          <div className="flex h-40 w-full items-center justify-center overflow-hidden bg-ink/5">
            <AdMedia
              ad={{ ...ad, image_url: ad.image_url ?? ad.restaurant_cover_url }}
              icon={Megaphone}
              loading="eager"
              width={ad.media_width ?? 600}
              height={ad.media_height ?? 450}
              className="h-full w-full object-contain"
            />
          </div>
        )}

        <div className="p-5 pt-4">
          <span className="mb-1 inline-flex w-fit items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
            Piblisite
          </span>
          <DialogTitle className="text-base">{ad.title}</DialogTitle>
          {ad.description && (
            <DialogDescription className="line-clamp-3 text-xs">{ad.description}</DialogDescription>
          )}
          {href && (
            <a
              href={href}
              onClick={close}
              className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-full bg-brand px-6 text-sm font-bold text-white shadow-brand-sm transition hover:bg-brand-deep"
            >
              Wè plis
            </a>
          )}

          {/* Karousèl — sèlman si plizyè anons popup aktif anmenm tan. */}
          {ads.length > 1 && (
            <div className="mt-3 flex items-center justify-between">
              <button
                type="button"
                onClick={prev}
                aria-label="Anons anvan"
                className="flex h-7 w-7 items-center justify-center rounded-full text-ink-soft transition hover:bg-brand-soft/40"
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
                className="flex h-7 w-7 items-center justify-center rounded-full text-ink-soft transition hover:bg-brand-soft/40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
