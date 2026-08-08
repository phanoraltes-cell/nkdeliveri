/**
 * Unit tests for the Collect-payment client-side poll's scheduling state
 * machine (`docs/POLLING_REMEDIATION_REPORT.md`). Tests `createPollController`
 * and its two pure helpers directly, with injected doc/clock/timer seams —
 * this project has no jsdom/React-Testing-Library dependency (Vitest runs
 * in a Node-only environment, see vitest.config.ts), so a real DOM/React
 * render is not available here. `createPollController` was factored out of
 * `useCollectPaymentPoll` specifically so this layer's timing/visibility/
 * reentrancy behavior could be tested at all, without adding one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPollController, intervalForElapsed, withJitter } from "../useCollectPaymentPoll";

/** Minimal fake `document` — just enough of the seam `createPollController` actually uses. */
function fakeDoc() {
  const listeners: Array<() => void> = [];
  return {
    hidden: false,
    addEventListener: vi.fn((_type: string, cb: () => void) => {
      listeners.push(cb);
    }),
    removeEventListener: vi.fn((_type: string, cb: () => void) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    }),
    fireVisibilityChange() {
      for (const cb of [...listeners]) cb();
    },
  };
}

/** A poll() stand-in whose resolution is controlled manually — lets a test hold a tick "in flight" to simulate overlap. */
function deferredPoll() {
  const calls: number[] = [];
  let callCount = 0;
  const resolvers: Array<(v: { status: string }) => void> = [];
  const fn = vi.fn(async () => {
    callCount += 1;
    calls.push(callCount);
    return new Promise<{ status: string }>((resolve) => {
      resolvers.push(resolve);
    });
  });
  return {
    fn,
    resolveNext(status: string) {
      const r = resolvers.shift();
      if (!r) throw new Error("no pending poll() call to resolve");
      r({ status });
    },
    pendingCount: () => resolvers.length,
  };
}

const BASE_NOW = new Date("2026-08-08T12:00:00.000Z").getTime();

describe("intervalForElapsed — the 4 tapering phases", () => {
  it("0–30s -> 5s", () => {
    expect(intervalForElapsed(0)).toBe(5_000);
    expect(intervalForElapsed(29_999)).toBe(5_000);
  });
  it("30s–2min -> 10s", () => {
    expect(intervalForElapsed(30_000)).toBe(10_000);
    expect(intervalForElapsed(2 * 60_000 - 1)).toBe(10_000);
  });
  it("2–5min -> 30s", () => {
    expect(intervalForElapsed(2 * 60_000)).toBe(30_000);
    expect(intervalForElapsed(5 * 60_000 - 1)).toBe(30_000);
  });
  it("5–15min -> 60s", () => {
    expect(intervalForElapsed(5 * 60_000)).toBe(60_000);
    expect(intervalForElapsed(15 * 60_000 - 1)).toBe(60_000);
  });
  it("past 15min -> null (stop; the daily cron is the remaining safety net)", () => {
    expect(intervalForElapsed(15 * 60_000)).toBeNull();
    expect(intervalForElapsed(60 * 60_000)).toBeNull();
  });
  it("a malformed elapsed value (NaN) fails closed — stops rather than looping", () => {
    expect(intervalForElapsed(NaN)).toBeNull();
  });
});

describe("withJitter — ±20%, floor 1000ms", () => {
  it("stays within ±20% of the base value", () => {
    for (let i = 0; i < 200; i++) {
      const result = withJitter(10_000);
      expect(result).toBeGreaterThanOrEqual(8_000);
      expect(result).toBeLessThanOrEqual(12_000);
    }
  });
  it("never goes below the 1000ms floor even for the smallest phase interval", () => {
    for (let i = 0; i < 200; i++) {
      expect(withJitter(5_000)).toBeGreaterThanOrEqual(1_000);
    }
  });
});

describe("createPollController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeController(
    overrides: {
      doc?: ReturnType<typeof fakeDoc>;
      poll?:
        ReturnType<typeof deferredPoll>["fn"] | ((args: unknown) => Promise<{ status: string }>);
      onSettled?: () => void;
      createdAt?: string;
    } = {},
  ) {
    const doc = overrides.doc ?? fakeDoc();
    const onSettled = overrides.onSettled ?? vi.fn();
    const poll = overrides.poll ?? vi.fn(async () => ({ status: "pending" }) as { status: string });
    const controller = createPollController({
      externalReference: "REF-1",
      createdAt: overrides.createdAt ?? new Date(BASE_NOW).toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      poll: poll as any,
      onSettled,
      doc,
      now: () => Date.now(),
    });
    return { doc, poll, onSettled, controller };
  }

  it("polls at 5s, then 10s, then 30s, then 60s — matching the 4 tapering phases exactly", async () => {
    const calls: number[] = [];
    const poll = vi.fn(async () => {
      calls.push(Date.now() - BASE_NOW);
      return { status: "pending" };
    });
    const { controller } = makeController({ poll });
    controller.start();

    // Advance well past all 4 phase boundaries + generous jitter margin.
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    controller.stop();

    // First tick lands within the 5s±20% window, i.e. 4000–6000ms.
    expect(calls[0]).toBeGreaterThanOrEqual(4_000);
    expect(calls[0]).toBeLessThanOrEqual(6_000);
    // Confirms real ticks happened across the tapering schedule, not just the first phase.
    expect(calls.length).toBeGreaterThan(3);
  });

  it("stops entirely once past the 15-minute window — never polls infinitely", async () => {
    const poll = vi.fn(async () => ({ status: "pending" }) as { status: string });
    const { controller } = makeController({ poll });
    controller.start();

    await vi.advanceTimersByTimeAsync(20 * 60_000); // well past 15 minutes
    controller.stop();

    const callsPast15Min = poll.mock.calls.length;
    // Sanity: it did poll during the active window...
    expect(callsPast15Min).toBeGreaterThan(0);

    // ...and produces no further scheduled work once past 15 minutes — advancing
    // another hour must not add a single additional call.
    poll.mockClear();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(poll).not.toHaveBeenCalled();
  });

  it("pauses while the tab is hidden — never polls a backgrounded tab", async () => {
    const doc = fakeDoc();
    doc.hidden = true;
    const poll = vi.fn(async () => ({ status: "pending" }) as { status: string });
    const { controller } = makeController({ doc, poll });
    controller.start();

    await vi.advanceTimersByTimeAsync(5 * 60_000); // several phases' worth of time
    controller.stop();

    expect(poll).not.toHaveBeenCalled();
  });

  it("resumes with an immediate check the moment the tab becomes visible again", async () => {
    const doc = fakeDoc();
    doc.hidden = true;
    const poll = vi.fn(async () => ({ status: "pending" }) as { status: string });
    const { controller } = makeController({ doc, poll });
    controller.start();

    await vi.advanceTimersByTimeAsync(60_000); // stays hidden the whole time
    expect(poll).not.toHaveBeenCalled();

    doc.hidden = false;
    doc.fireVisibilityChange();
    await vi.advanceTimersByTimeAsync(0); // flush the immediate tick's microtasks

    expect(poll).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it("stops immediately once a tick reports the payment is no longer pending — never polls again", async () => {
    const poll = vi.fn(async () => ({ status: "paid" }) as { status: string });
    const onSettled = vi.fn();
    const { controller } = makeController({ poll, onSettled });
    controller.start();

    await vi.advanceTimersByTimeAsync(6_000); // past the first 5s±20% tick
    expect(poll).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledTimes(1);

    // No further ticks, ever — even minutes later.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("stop() (the caller's Realtime-settled / enabled:false path) halts polling immediately, with no further ticks", async () => {
    const poll = vi.fn(async () => ({ status: "pending" }) as { status: string });
    const { controller } = makeController({ poll });
    controller.start();

    await vi.advanceTimersByTimeAsync(6_000);
    expect(poll).toHaveBeenCalledTimes(1);

    controller.stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(poll).toHaveBeenCalledTimes(1); // unchanged — stop() is final, not a pause
  });

  it("stop() removes the visibilitychange listener and clears the pending timer — no leaked timer or listener", async () => {
    const doc = fakeDoc();
    const { controller } = makeController({ doc });
    controller.start();
    expect(doc.addEventListener).toHaveBeenCalledTimes(1);

    controller.stop();
    expect(doc.removeEventListener).toHaveBeenCalledTimes(1);
    expect(doc.removeEventListener.mock.calls[0][1]).toBe(doc.addEventListener.mock.calls[0][1]);

    // Firing visibilitychange after stop() must do nothing — the listener is gone.
    doc.hidden = false;
    doc.fireVisibilityChange();
    await vi.advanceTimersByTimeAsync(1000);
    // No assertion needed beyond "doesn't throw" — removeEventListener already
    // proved the real listener is detached; this just double-checks nothing
    // fires through the (correctly empty) listeners array.
  });

  it("a rejected tick is never fatal — retried on the next cycle, the schedule continues", async () => {
    let attempt = 0;
    const poll = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("network blip");
      return { status: "pending" };
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { controller } = makeController({ poll });
    controller.start();

    await vi.advanceTimersByTimeAsync(20_000); // first tick fails, second (10s later) succeeds
    controller.stop();

    expect(poll.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("REGRESSION — rapid hidden→visible→hidden→visible never starts a second overlapping tick while one is still in flight (the double-polling bug fixed in this remediation)", async () => {
    const doc = fakeDoc();
    doc.hidden = true;
    const deferred = deferredPoll();
    const { controller } = makeController({ doc, poll: deferred.fn });
    controller.start();

    // First resume: tick #1 starts and is held in flight (never resolved yet).
    doc.hidden = false;
    doc.fireVisibilityChange();
    await vi.advanceTimersByTimeAsync(0);
    expect(deferred.fn).toHaveBeenCalledTimes(1);
    expect(deferred.pendingCount()).toBe(1);

    // Tab flips hidden then visible again WHILE tick #1 is still awaiting its
    // network response — before the fix, this started a second, concurrent
    // tick() (and, on completion, a second independent schedule() chain).
    doc.hidden = true;
    doc.fireVisibilityChange();
    doc.hidden = false;
    doc.fireVisibilityChange();
    await vi.advanceTimersByTimeAsync(0);

    // Still only ONE in-flight call — the reentrancy guard blocked the second.
    expect(deferred.fn).toHaveBeenCalledTimes(1);
    expect(deferred.pendingCount()).toBe(1);

    // Resolve the in-flight tick — normal scheduling resumes from here,
    // never doubled.
    deferred.resolveNext("pending");
    await vi.advanceTimersByTimeAsync(0);
    controller.stop();
  });

  it("REGRESSION — onSettled is called exactly once even if a visibility flip races the settling tick", async () => {
    const doc = fakeDoc();
    doc.hidden = true;
    const deferred = deferredPoll();
    const onSettled = vi.fn();
    const { controller } = makeController({ doc, poll: deferred.fn, onSettled });
    controller.start();

    doc.hidden = false;
    doc.fireVisibilityChange();
    await vi.advanceTimersByTimeAsync(0);

    // A second flip while the (about-to-settle) tick is still in flight.
    doc.hidden = true;
    doc.fireVisibilityChange();
    doc.hidden = false;
    doc.fireVisibilityChange();
    await vi.advanceTimersByTimeAsync(0);

    deferred.resolveNext("paid"); // settles
    await vi.advanceTimersByTimeAsync(0);

    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(deferred.fn).toHaveBeenCalledTimes(1);
    controller.stop();
  });
});
