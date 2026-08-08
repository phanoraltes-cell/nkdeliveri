import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { pollCollectPayment } from "@/lib/poll-collect-payment.functions";

/**
 * Adaptive client-side poll for a `pending` PLOP Collect payment — the
 * PRIMARY confirmation mechanism (docs/PLOP_PHASE1_ARCHITECTURE.md § 3
 * /§ 3bis), never the daily reconciliation cron (a safety net only, see
 * that same doc's callout). 4 tapering phases over 15 minutes, ≤31
 * requests/session — see docs/PLOP_REMEDIATION_REPORT.md § 3 for the
 * per-phase justification of these exact numbers.
 *
 * Paced off `createdAt` (the `payment_transactions` row's own creation
 * time), never "time since this hook mounted" — a page refresh recomputes
 * the same elapsed time and resumes at the correct phase instead of
 * restarting the fast/frequent phase every time (audit recommendation,
 * docs/PLOP_PHASE2_AUDIT.md § 6). This is also what makes "resume after
 * refresh" and "resume after the browser was closed and reopened" work
 * for free: whatever elapsed time has really passed is recomputed fresh
 * on every mount, no client-side state to restore.
 *
 * The scheduling state machine (`createPollController`) is deliberately
 * factored out of the `useEffect` and parameterized over its DOM/clock/
 * network seams — this project has no jsdom/React-Testing-Library
 * dependency (Node-only Vitest environment), so this is what makes the
 * timing/visibility/reentrancy behavior below actually testable at all
 * (docs/POLLING_REMEDIATION_REPORT.md) without adding one. The hook
 * itself stays a thin wire-up: identical public API, identical behavior.
 */

type Phase = { untilMs: number; intervalMs: number };

const PHASES: Phase[] = [
  { untilMs: 30_000, intervalMs: 5_000 }, // 0–30s: fenêtre chaude
  { untilMs: 2 * 60_000, intervalMs: 10_000 }, // 30s–2min: confirmation en cours
  { untilMs: 5 * 60_000, intervalMs: 30_000 }, // 2–5min: attente active
  { untilMs: 15 * 60_000, intervalMs: 60_000 }, // 5–15min: filet avant relais au cron
];

/** Exported for direct unit testing of the phase boundaries (docs/POLLING_REMEDIATION_REPORT.md). */
export function intervalForElapsed(elapsedMs: number): number | null {
  for (const phase of PHASES) {
    if (elapsedMs < phase.untilMs) return phase.intervalMs;
  }
  return null; // past 15 minutes — stop; the daily cron is the remaining safety net
}

/** ±20% — spreads concurrent pollers (e.g. many checkouts started in the same minute) so their ticks don't all land on PLOP at once. Exported for direct unit testing. */
export function withJitter(ms: number): number {
  const jitter = ms * 0.2 * (Math.random() * 2 - 1);
  return Math.max(1000, Math.round(ms + jitter));
}

type PollTickResult = { status: string };

type DocumentSeam = Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;

export type PollControllerParams = {
  externalReference: string;
  createdAt: string;
  poll: (args: { data: { externalReference: string } }) => Promise<PollTickResult>;
  onSettled: () => void;
  /** Injectable seams — default to the real globals; tests supply fakes. Never required in production use. */
  doc?: DocumentSeam;
  now?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  /** Called after each tick (success, settle, or error) — test-only hook to observe completion without racing real timers. */
  onTickSettled?: () => void;
};

export type PollController = {
  start(): void;
  stop(): void;
};

/**
 * The actual schedule/tick/visibility state machine, DOM- and
 * timer-agnostic. Behavior preserved exactly from the pre-refactor
 * version, plus one real fix found during audit
 * (docs/POLLING_REMEDIATION_REPORT.md): `tick()` now guards against
 * re-entrant/overlapping invocations (`inFlight`) — previously, a rapid
 * hidden→visible→hidden→visible flip could start a second `tick()` while
 * the first was still awaiting its network call, and each would
 * independently call `schedule()` on completion, orphaning the earlier
 * timer (only the last `timeoutHandle` assignment is ever tracked/
 * clearable) and leaving two live polling chains running from then on —
 * genuine double-polling, not merely a theoretical race, since
 * `visibilitychange` can fire multiple times before an in-flight `await`
 * resolves (verified with a dedicated test, not assumed).
 */
export function createPollController(params: PollControllerParams): PollController {
  const doc = params.doc ?? document;
  const now = params.now ?? Date.now;
  const scheduleTimeout = params.setTimeoutFn ?? setTimeout;
  const cancelTimeout = params.clearTimeoutFn ?? clearTimeout;

  let cancelled = false;
  let inFlight = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  function schedule() {
    const elapsedMs = now() - new Date(params.createdAt).getTime();
    const interval = intervalForElapsed(elapsedMs);
    if (interval === null) return; // beyond the 15-minute window — hand off to the cron
    timeoutHandle = scheduleTimeout(() => void tick(), withJitter(interval));
  }

  async function tick() {
    if (cancelled) return;
    if (inFlight) return; // reentrancy guard — see header comment
    if (doc.hidden) {
      // Paused while backgrounded — no poll, no reschedule here;
      // handleVisibilityChange below is what resumes this, with an
      // immediate check, the moment the tab is visible again. Never
      // burns a cycle polling a tab nobody is looking at.
      return;
    }
    inFlight = true;
    try {
      const result = await params.poll({ data: { externalReference: params.externalReference } });
      if (cancelled) return;
      if (result.status !== "pending") {
        params.onSettled();
        return; // settled — stop polling entirely
      }
    } catch (err) {
      // A single failed tick is never fatal — retried next cycle; the
      // daily cron remains the ultimate safety net regardless.
      console.warn("[collect-poll] tick failed", err);
    } finally {
      inFlight = false;
      params.onTickSettled?.();
    }
    if (cancelled) return;
    schedule();
  }

  function handleVisibilityChange() {
    if (doc.hidden) return;
    if (timeoutHandle) cancelTimeout(timeoutHandle);
    void tick();
  }

  return {
    start() {
      doc.addEventListener("visibilitychange", handleVisibilityChange);
      schedule();
    },
    stop() {
      cancelled = true;
      if (timeoutHandle) cancelTimeout(timeoutHandle);
      doc.removeEventListener("visibilitychange", handleVisibilityChange);
    },
  };
}

export function useCollectPaymentPoll(params: {
  /** Only polls while true — callers gate this on `payment_transactions.status === 'pending'`. */
  enabled: boolean;
  externalReference: string | undefined;
  /** `payment_transactions.created_at` — the pacing anchor, see module comment. */
  createdAt: string | undefined;
  /** Called once a tick reports the payment is no longer pending — never called more than once per settle. Typically a query invalidation; Realtime (already wired on `payments`) may also fire independently, whichever arrives first wins. */
  onSettled: () => void;
}): void {
  const { enabled, externalReference, createdAt } = params;
  // Read through a ref so a re-render that only changes the `onSettled`
  // closure identity (e.g. a parent re-render) never tears down and
  // restarts the effect below — only enabled/externalReference/createdAt
  // changing should do that.
  const onSettledRef = useRef(params.onSettled);
  onSettledRef.current = params.onSettled;

  // useServerFn (same wrapper checkout.tsx uses for every server function
  // call) — resolves a thrown redirect (e.g. an expired session) via the
  // router instead of letting the effect's own catch block treat it as
  // just another failed tick to silently retry.
  const poll = useServerFn(pollCollectPayment);
  const pollRef = useRef(poll);
  pollRef.current = poll;

  useEffect(() => {
    if (!enabled || !externalReference || !createdAt) return;

    const controller = createPollController({
      externalReference,
      createdAt,
      poll: (args) => pollRef.current(args),
      onSettled: () => onSettledRef.current(),
    });
    controller.start();
    return () => controller.stop();
  }, [enabled, externalReference, createdAt]);
}
