import { Laptop, Smartphone, Tablet, Trash2, BellOff, Bell } from "lucide-react";
import { useMyDevices } from "@/hooks/useMyDevices";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { parseUserAgent } from "@/lib/parse-user-agent";
import { Skeleton } from "@/components/ui/skeleton";

const DEVICE_ICON = { Telefòn: Smartphone, Tablèt: Tablet, Òdinatè: Laptop } as const;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-HT", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * "Mes appareils" — every browser this user has ever authorized push
 * notifications on. Distinct from "Sesyon aktif" (active-sessions-section.tsx):
 * that one is about logged-in sessions (auth.sessions), this one is about
 * which devices get a push notification (push_subscriptions) — a user can
 * be logged in on a device with push disabled, or vice versa on an old
 * device that still has a stale subscription after signing out elsewhere.
 */
export function MyDevicesSection() {
  const { devices, currentEndpoint, remove, setEnabled } = useMyDevices();
  const { requestConfirm, ConfirmDialog } = useConfirmDialog();

  const rows = devices.data ?? [];

  function confirmRemove(id: string) {
    requestConfirm(
      "Retire aparèy sa a? Ou p ap resevwa notifikasyon push sou li ankò jiskaske w reyaktive yo.",
      () => remove.mutate(id),
    );
  }

  return (
    <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-brand-xs">
      <h2 className="mb-3 font-display text-lg font-bold text-ink">Aparèy mwen</h2>
      <p className="mb-3 text-xs text-ink-soft">
        Aparèy ki gen dwa voye w yon notifikasyon push, menm lè NK Deliveri fèmen.
      </p>

      {devices.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      )}

      {!devices.isLoading && rows.length === 0 && (
        <p className="text-sm text-ink-soft">Ou poko aktive notifikasyon push sou okenn aparèy.</p>
      )}

      <ul className="space-y-2">
        {rows.map((d) => {
          const { device, browser, os } = parseUserAgent(d.user_agent);
          const Icon = DEVICE_ICON[device as keyof typeof DEVICE_ICON] ?? Laptop;
          const isCurrent = !!currentEndpoint && currentEndpoint === d.endpoint;
          return (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-xl bg-brand-soft/20 px-3 py-2.5"
            >
              <div className="flex items-center gap-3">
                <Icon className="h-5 w-5 shrink-0 text-brand-deep" aria-hidden="true" />
                <div className="text-sm">
                  <div className="flex items-center gap-1.5 font-semibold text-ink">
                    {browser} · {os}
                    {isCurrent && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                        Aparèy aktyèl
                      </span>
                    )}
                    {!d.enabled && (
                      <span className="rounded-full bg-ink/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-soft">
                        Anpeche
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-ink-soft">
                    Otorize {formatDate(d.created_at)} · Dènye aktivite {formatDate(d.last_used_at)}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => setEnabled.mutate({ id: d.id, enabled: !d.enabled })}
                  disabled={setEnabled.isPending}
                  aria-label={
                    d.enabled
                      ? "Anpeche notifikasyon pou aparèy sa a"
                      : "Reyaktive notifikasyon pou aparèy sa a"
                  }
                  title={
                    d.enabled
                      ? "Anpeche notifikasyon pou aparèy sa a"
                      : "Reyaktive notifikasyon pou aparèy sa a"
                  }
                  className="rounded-full p-2 text-ink-soft transition hover:bg-white hover:text-brand-deep disabled:opacity-50"
                >
                  {d.enabled ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => confirmRemove(d.id)}
                  disabled={remove.isPending}
                  aria-label="Retire aparèy sa a"
                  title="Retire aparèy sa a"
                  className="rounded-full p-2 text-ink-soft transition hover:bg-white hover:text-red-600 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {ConfirmDialog}
    </section>
  );
}
