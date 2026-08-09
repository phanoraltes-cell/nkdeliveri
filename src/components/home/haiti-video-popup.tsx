import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Play, Pause, Volume2, VolumeX, Minus, X, Maximize } from "lucide-react";

// Refonte Home — Kategori Pla + Vidéo, post-P10. Same "dismiss, remember
// for a while" family as install-prompt.tsx's nk-install-dismissed-at,
// but sessionStorage rather than localStorage: an explicit close here
// should only hold for the current browsing session (the spec is
// explicit — reappearing next visit is fine, reappearing immediately
// after a deliberate close within the same session is not), unlike the
// 14-day install-prompt cooldown.
const CLOSED_KEY = "nk-haiti-video-closed";

type PopupState = "minimized" | "open" | "closed";

function initialState(): PopupState {
  if (typeof window === "undefined") return "minimized";
  try {
    return sessionStorage.getItem(CLOSED_KEY) === "1" ? "closed" : "minimized";
  } catch {
    // Storage can throw in locked-down browsing contexts (private mode
    // edge cases, storage disabled by policy) — degrade to "always show
    // minimized," never to "always show open" or "never show."
    return "minimized";
  }
}

/**
 * Floating, minimizable "Bèlte Ayiti" video widget — home page only (never
 * mounted in __root.tsx), so it can never appear over checkout or order
 * tracking. Starts minimized (a small pill, not the open player) so
 * nothing autoplays and nothing is downloaded — see the `hasOpenedOnce`
 * gate below — until the visitor actively chooses to open it, which also
 * means there's no autoplay-with-sound question to solve at all.
 */
export function HaitiVideoPopup() {
  const [state, setState] = useState<PopupState>(initialState);
  // Video element is only ever mounted after the visitor presses Play —
  // not just on "open." Opening the card first shows a static cover
  // (brand gradient + Play button) so preload="none" isn't even relied
  // on to keep bytes at zero pre-interaction; there's simply no <video>
  // in the DOM yet.
  const [hasStartedPlaying, setHasStartedPlaying] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Keyboard focus follow-through — found missing by an actual Tab-through
  // check, not assumed correct: activating the minimized pill unmounts it
  // and mounts the open panel, but without this, focus is silently
  // dropped to <body> instead of landing somewhere useful inside it
  // (Radix's Dialog does this automatically; this widget is deliberately
  // a plain non-modal div, so it doesn't come for free).
  const playCoverRef = useRef<HTMLButtonElement>(null);
  const minimizedPillRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Set by open()/minimize() right when the visitor acts, consumed by
  // the *entering* element's own onAnimationComplete below — a ref, not
  // a useEffect keyed on `state`, for two reasons: (1) AnimatePresence's
  // mode="wait" defers mounting the incoming element until the outgoing
  // one's exit animation finishes, so a `state`-keyed effect fires — and
  // reads a still-null ref — before the new node exists; (2) the
  // *exiting* element's own onAnimationComplete closure still sees
  // whatever `state` was captured at its last real render (i.e. always
  // "stale", never the post-click value), so checking `state` there
  // can't distinguish "just started exiting because of this click" from
  // "entering for an unrelated reason" either — a ref read at call time
  // sidesteps both problems. Never set on the initial, unprompted
  // appearance (heroCleared flipping) or on close(), so neither steals
  // focus from wherever the visitor actually is on the page.
  const pendingFocus = useRef<"pill" | "cover" | null>(null);

  // Real visual bug found while checking actual renders (not just
  // compile/lint): the Hero's own "Peman disponib" badge sits bottom-right
  // of the Hero, in the same corner this widget occupies — opening the
  // (taller) video card while still scrolled to the top overlapped it on
  // common desktop viewport heights. Rather than a static offset that
  // can't fully solve a scroll-position-dependent overlap, the widget
  // simply doesn't render at all (not even minimized) until the visitor
  // has scrolled past the Hero — matches "appears discreetly" arguably
  // better than appearing instantly on load, and fully removes the
  // collision since the two are never on screen together.
  const [heroCleared, setHeroCleared] = useState(false);
  useEffect(() => {
    const hero = document.getElementById("hero");
    if (!hero) {
      // Defensive fallback: never let a missing/renamed selector
      // permanently hide the feature.
      setHeroCleared(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) {
          setHeroCleared(true);
          observer.disconnect();
        }
      },
      { threshold: 0 },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  function close() {
    setState("closed");
    setPlaying(false);
    try {
      sessionStorage.setItem(CLOSED_KEY, "1");
    } catch {
      // Best-effort — worst case the popup can reappear on a later
      // navigation within the same session, not a functional break.
    }
  }

  function minimize() {
    videoRef.current?.pause();
    setPlaying(false);
    pendingFocus.current = "pill";
    setState("minimized");
  }

  function open() {
    pendingFocus.current = "cover";
    setState("open");
  }

  function togglePlay() {
    if (!hasStartedPlaying) {
      setHasStartedPlaying(true);
      // Video element mounts this render; actually start it next tick.
      requestAnimationFrame(() => {
        videoRef.current?.play().catch(() => undefined);
      });
      setPlaying(true);
      return;
    }
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  }

  function toggleMute() {
    const el = videoRef.current;
    setMuted((m) => {
      if (el) el.muted = !m;
      return !m;
    });
  }

  function goFullscreen() {
    videoRef.current?.requestFullscreen?.().catch(() => undefined);
  }

  if (state === "closed" || !heroCleared) return null;

  return (
    <div
      className={`fixed right-[max(1rem,var(--sar))] bottom-[calc(4rem+var(--sab)+1rem)] z-40 md:right-4 ${
        // Slightly more breathing room for the larger open card than the
        // small minimized pill needs — a plain visual-balance choice, not
        // a collision workaround (the heroCleared gate above is what
        // actually prevents the Hero-badge overlap).
        state === "open" ? "md:bottom-10" : "md:bottom-4"
      }`}
      style={{ maxWidth: "calc(100vw - 2rem)" }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {state === "minimized" ? (
          <motion.button
            key="minimized"
            ref={minimizedPillRef}
            type="button"
            onClick={open}
            aria-expanded={false}
            aria-controls="haiti-video-panel"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.18 }}
            onAnimationComplete={() => {
              if (pendingFocus.current === "pill") {
                pendingFocus.current = null;
                minimizedPillRef.current?.focus();
              }
            }}
            className="flex items-center gap-2 rounded-full bg-white py-2.5 pl-3 pr-4 shadow-[0_12px_28px_rgba(0,0,0,0.18)] ring-1 ring-brand-soft/60 transition hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(0,0,0,0.22)]"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-white">
              <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
            </span>
            <span className="text-sm font-bold text-ink">Bèlte Ayiti</span>
          </motion.button>
        ) : (
          <motion.div
            id="haiti-video-panel"
            key="open"
            ref={panelRef}
            role="group"
            aria-label="Videyo Bèlte Ayiti"
            tabIndex={-1}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.22 }}
            onAnimationComplete={() => {
              if (pendingFocus.current === "cover") {
                pendingFocus.current = null;
                // The cover only exists pre-Play; once a visitor has
                // played the video before, re-opening shows the video +
                // controls bar instead, so falls back to the panel
                // itself (tabIndex={-1} makes that a valid, if unusual,
                // programmatic focus target — same technique Radix Dialog
                // uses on its own content root).
                (playCoverRef.current ?? panelRef.current)?.focus();
              }
            }}
            className="w-[260px] overflow-hidden rounded-3xl bg-ink shadow-[0_20px_48px_rgba(0,0,0,0.3)] ring-1 ring-white/10 sm:w-[300px]"
          >
            <div className="relative aspect-video w-full bg-gradient-to-br from-brand-deep via-brand to-brand-light">
              {hasStartedPlaying ? (
                <video
                  ref={videoRef}
                  src="/kategori/haiti-tourisme.mp4"
                  preload="none"
                  muted={muted}
                  playsInline
                  loop
                  className="h-full w-full object-cover"
                  onEnded={() => setPlaying(false)}
                />
              ) : (
                <button
                  ref={playCoverRef}
                  type="button"
                  onClick={togglePlay}
                  aria-label="Jwe videyo Bèlte Ayiti"
                  className="flex h-full w-full flex-col items-center justify-center gap-2 text-white"
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20 backdrop-blur transition group-hover:scale-110">
                    <Play className="h-6 w-6 fill-current" aria-hidden="true" />
                  </span>
                  <span className="font-display text-sm font-extrabold">Bèlte Ayiti</span>
                </button>
              )}
            </div>

            <div className="flex items-center justify-between gap-1 px-3 py-2.5">
              <div className="flex items-center gap-1">
                {hasStartedPlaying && (
                  <>
                    <button
                      type="button"
                      onClick={togglePlay}
                      aria-label={playing ? "Mete videyo a sou poz" : "Jwe videyo a"}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-white/90 transition hover:bg-white/10"
                    >
                      {playing ? (
                        <Pause className="h-4 w-4 fill-current" aria-hidden="true" />
                      ) : (
                        <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={toggleMute}
                      aria-pressed={muted}
                      aria-label={muted ? "Aktive son" : "Koupe son"}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-white/90 transition hover:bg-white/10"
                    >
                      {muted ? (
                        <VolumeX className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Volume2 className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={goFullscreen}
                      aria-label="Videyo an plen ekran"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-white/90 transition hover:bg-white/10"
                    >
                      <Maximize className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={minimize}
                  aria-label="Minimize videyo a"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-white/90 transition hover:bg-white/10"
                >
                  <Minus className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Fèmen videyo a"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-white/90 transition hover:bg-white/10"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
