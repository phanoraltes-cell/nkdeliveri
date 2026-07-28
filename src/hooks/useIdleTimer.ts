import { useEffect, useRef } from "react";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"] as const;

/**
 * Generic inactivity detector — fires `onIdle` once after `timeoutMs` of no
 * mouse/keyboard/touch/scroll activity, and resets on the next activity
 * after that (won't re-fire repeatedly while genuinely idle). Not tied to
 * any role; the admin-only idle lock (admin-idle-lock.tsx) is what decides
 * *who* this applies to by only mounting around admin routes.
 */
export function useIdleTimer(timeoutMs: number, onIdle: () => void, enabled = true) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled) return;

    function reset() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onIdleRef.current(), timeoutMs);
    }

    reset();
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, reset, { passive: true }));
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, reset));
    };
  }, [timeoutMs, enabled]);
}
