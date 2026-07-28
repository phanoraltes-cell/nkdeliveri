// In-app notification sound — for the case the Notification API itself
// can't cover: the tab is open and focused, so the service worker's push
// handler deliberately skips showNotification() (see sw.ts's
// alreadyFocusedHere check) and Realtime is what updates the screen
// instead. A synthesized beep via Web Audio, not an audio file — no new
// binary asset to ship, and it sidesteps every browser's autoplay
// restrictions differently than <audio> would (still subject to the same
// "needs a prior user gesture" rule everywhere; failures are swallowed,
// see playNotificationSound below, which is the graceful degradation the
// spec asks for: a user who has never interacted with the tab just
// doesn't hear anything until they do, same as any other web audio).
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  return audioCtx;
}

/** Best-effort short "ding" — never throws, never blocks the caller. */
export function playNotificationSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => undefined);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // Autoplay policy blocked it, or Web Audio isn't available — silence
    // is the correct fallback, never surface this as an error to the user.
  }
}

/** Vibration (mobile only — silently a no-op everywhere else, including every desktop browser and iOS Safari). */
export function vibrateDevice() {
  try {
    navigator.vibrate?.(200);
  } catch {
    // Same graceful-degradation posture as playNotificationSound.
  }
}
