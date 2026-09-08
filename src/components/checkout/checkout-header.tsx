import { useRouter } from "@tanstack/react-router";
import { ArrowLeft, ShieldCheck } from "lucide-react";

/**
 * TACH 2 §1 — antèt paj peman an.
 *
 * Twa bagay, pa yon de plis: flèch retou, tit "Peman", ak mak konfyans lan.
 * Li rete kole anlè (`sticky`) paske sou telefòn paj la long: san sa, yon
 * moun ki fin desann nan seksyon peman an pa gen okenn fason pou soti san
 * li pa remonte tout paj la.
 *
 * Flèch la sèvi ak istwa navigatè a (`history.back()`) pou moun nan
 * retounen EGZAKTEMAN kote li te ye a — souvan paj yon restoran. Si pa gen
 * istwa (moun nan louvri /checkout dirèkteman nan yon lyen), nou tonbe sou
 * akèy la olye nou kite yon bouton ki pa fè anyen.
 */
export function CheckoutHeader() {
  const router = useRouter();

  function goBack() {
    if (router.history.canGoBack()) {
      router.history.back();
      return;
    }
    void router.navigate({ to: "/" });
  }

  return (
    <header className="sticky top-0 z-30 border-b border-brand-soft/60 bg-cream/95 backdrop-blur supports-[backdrop-filter]:bg-cream/80">
      <div className="mx-auto flex max-w-[720px] items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={goBack}
          aria-label="Retounen"
          className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink transition hover:bg-brand-soft/60 focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <h1 className="flex-1 font-display text-lg font-extrabold text-ink">Peman</h1>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-status-good-soft px-2.5 py-1 text-xs font-bold text-status-good">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Done w yo pwoteje
        </span>
      </div>
    </header>
  );
}
