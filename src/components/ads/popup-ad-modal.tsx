import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Megaphone } from "lucide-react";
import { useActivePlacements } from "@/hooks/useActivePlacements";
import { AdMedia } from "@/components/ads/ad-media";
import { getAdAspectRatio } from "@/lib/ad-aspect-ratio";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

// Tach 5 — menm konvansyon "dismiss + cooldown nan localStorage" ak
// install-prompt.tsx (DISMISS_KEY/DISMISS_COOLDOWN_MS/recentlyDismissed),
// men KEYED pa anons (chak popup gen pwòp konpteur li) — yon admin ki
// ranplase anons popup la pa dwe rete "kache" akoz yon dismiss ki te vize
// yon lòt anons antyèman.
const DISMISS_KEY_PREFIX = "nk-popup-ad-dismissed-";
const DISMISS_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 èdtan

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

function recentlyDismissed(adId: string): boolean {
  const raw = localStorage.getItem(DISMISS_KEY_PREFIX + adId);
  if (!raw) return false;
  return Date.now() - Number(raw) < DISMISS_COOLDOWN_MS;
}

/**
 * Tach 5 — nouvo tip anons "popup": yon modal ki parèt otomatikman (yon
 * sèl fwa pou chak 24 èdtan pou menm anons/menm navigatè), jamè pandan
 * checkout/auth/dashboard. Focus-trap, fèmti ak tou Esc, ak wòl ARIA
 * "dialog" se Radix Dialog (src/components/ui/dialog.tsx, deja itilize
 * toupatou nan sit la) ki bay yo gratis — pa gen anyen pou re-enplemante.
 */
export function PopupAdModal() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const placements = useActivePlacements("popup", 1);
  const ad = placements.data?.[0];
  const [open, setOpen] = useState(false);
  // Anons ki DEJA jwenn tretman (montre oswa jije "twò recheman fèmen")
  // pandan sesyon paj sa a — anpeche yon 2èm re-deklanchman si `ad`
  // rechaje (refetch background) pandan modal la deja louvri/fèmen.
  const [handledAdId, setHandledAdId] = useState<string | null>(null);

  useEffect(() => {
    if (!ad || isPopupExcludedRoute(pathname)) {
      setOpen(false);
      return;
    }
    if (handledAdId === ad.id || recentlyDismissed(ad.id)) return;
    // Ti delè (1.2s) pou pa fè modal la parèt egzakteman nan menm segond
    // ak premye chajman paj la — kite kontni reyèl la parèt dabò.
    const timer = setTimeout(() => {
      setHandledAdId(ad.id);
      setOpen(true);
    }, 1200);
    return () => clearTimeout(timer);
  }, [ad, pathname, handledAdId]);

  function dismiss() {
    if (ad) localStorage.setItem(DISMISS_KEY_PREFIX + ad.id, String(Date.now()));
    setOpen(false);
  }

  if (!ad) return null;

  const ratio = getAdAspectRatio(ad);
  const hasMedia = !!(ad.media_url || ad.image_url || ad.restaurant_cover_url);
  const href =
    ad.link_url ?? (ad.restaurant_slug ? `/restaurants/${ad.restaurant_slug}` : undefined);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Radix rele sa a ak `false` pou Esc, klike deyò, AK bouton X la —
        // yon sèl chemen fèmti pou anrejistre dismiss la, kèlkeswa mwayen
        // an itilizatè a te chwazi.
        if (!next) dismiss();
      }}
    >
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
        {hasMedia && (
          <div
            className={ratio ? "bg-ink/5" : "aspect-[4/3] bg-ink/5"}
            style={ratio ? { aspectRatio: ratio } : undefined}
          >
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
        <div className="p-6 pt-4">
          <DialogHeader>
            <span className="mb-1 inline-flex w-fit items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
              Piblisite
            </span>
            <DialogTitle>{ad.title}</DialogTitle>
            {ad.description && <DialogDescription>{ad.description}</DialogDescription>}
          </DialogHeader>
          {href && (
            <a
              href={href}
              onClick={dismiss}
              className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-full bg-brand px-6 text-sm font-bold text-white shadow-brand-sm transition hover:bg-brand-deep"
            >
              Wè plis
            </a>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
