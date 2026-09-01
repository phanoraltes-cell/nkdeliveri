import { Check } from "lucide-react";
import { ORDER_STATUS_LABEL } from "@/lib/order-status";
import { StatusBadge } from "@/components/dashboard/status-badge";

/**
 * Order lifecycle steps shown on the tracking timeline. `matches` folds
 * deliveries.status values that don't have their own orders.status step
 * (assigned/picked_up) into the single "An livrezon" step — the customer
 * cares that a driver is en route, not which of those two DB states it is.
 */
const STEPS: { key: string; label: string; matches?: string[] }[] = [
  { key: "pending", label: "An atant" },
  { key: "confirmed", label: "Konfime" },
  { key: "preparing", label: "Ap prepare" },
  { key: "ready", label: "Prè" },
  { key: "delivering", label: "An livrezon", matches: ["assigned", "picked_up"] },
  { key: "delivered", label: "Livre" },
];

// cancelled/refunded never fit a forward-progress metaphor — shown as a
// distinct flat state instead of a timeline stalled mid-way.
const TERMINAL_NEGATIVE = new Set(["cancelled", "refunded"]);

function stepIndexForStatus(status: string): number {
  const i = STEPS.findIndex((s) => s.key === status || s.matches?.includes(status));
  return i === -1 ? 0 : i;
}

/**
 * Order-detail page's single progress indicator. Refonte Frontend Premium,
 * Phase 2 (P2) — replaces the previous "Estati kòmand" + "Estati peman"
 * two-card grid with one horizontal timeline (see
 * docs/archive/phases/PHASE0_PREPARATION_REPORT.md and the Refonte spec's P2 wireframe).
 *
 * Deliberately does NOT show payment nuance (awaiting proof, automatic
 * rail pending/failed) — that's the contextual banner's job in
 * orders.$id.tsx, rendered right below this component. This one does
 * exactly one thing: current step + next step of the order's own
 * lifecycle, so it stays legible regardless of which payment method or
 * rail is behind it.
 */
export function OrderStatusTimeline({ status }: { status: string }) {
  if (TERMINAL_NEGATIVE.has(status)) {
    return (
      <div className="rounded-2xl bg-white p-5 shadow-brand-xs ring-1 ring-brand-soft/40">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs uppercase tracking-wider text-ink-soft">Estati kòmand</div>
          <StatusBadge tone="bad" className="shrink-0 px-3 py-1 text-xs">
            {ORDER_STATUS_LABEL[status] ?? status}
          </StatusBadge>
        </div>
      </div>
    );
  }

  const activeIndex = stepIndexForStatus(status);
  const isDelivered = activeIndex === STEPS.length - 1;

  return (
    <div className="rounded-2xl bg-white p-5 shadow-brand-xs ring-1 ring-brand-soft/40">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-wider text-ink-soft">Estati kòmand</div>
        <StatusBadge tone={isDelivered ? "good" : "info"} className="shrink-0 px-3 py-1 text-xs">
          {STEPS[activeIndex].label}
        </StatusBadge>
      </div>
      {/* Refonte Frontend Premium, Phase 7 (P7) — the step badge above
          already states the current step in real text, but the steps
          themselves conveyed done/current/upcoming purely visually (color,
          ring, a checkmark icon that's aria-hidden). aria-current="step"
          (the ARIA value built for exactly this — a step within a
          process) plus a visually-hidden state suffix per <li> close that
          gap without changing anything sighted users see. */}
      <ol className="flex items-start" aria-label="Pwogrè kòmand">
        {STEPS.map((step, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          return (
            <li
              key={step.key}
              aria-current={active ? "step" : undefined}
              className="relative flex-1 text-center"
            >
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className={`absolute left-[-50%] right-1/2 top-2 h-0.5 ${
                    i <= activeIndex ? "bg-brand" : "bg-brand-soft"
                  }`}
                />
              )}
              <span
                className={`relative z-10 mx-auto flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                  done
                    ? "border-brand bg-brand text-white"
                    : active
                      ? "border-brand bg-white ring-4 ring-brand-soft"
                      : "border-brand-soft bg-white"
                }`}
              >
                {done && <Check className="h-2.5 w-2.5" aria-hidden="true" />}
              </span>
              <span
                className={`mt-1.5 block text-xs font-semibold leading-tight ${
                  done || active ? "text-ink" : "text-ink-soft/70"
                }`}
              >
                {step.label}
                {done && <span className="sr-only"> — fini</span>}
                {active && <span className="sr-only"> — etap aktyèl</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
