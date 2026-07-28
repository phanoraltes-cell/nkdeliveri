import { Laptop, Smartphone, Tablet, LogOut, ShieldOff } from "lucide-react";
import { useActiveSessions } from "@/hooks/useActiveSessions";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { parseUserAgent } from "@/lib/parse-user-agent";
import { Skeleton } from "@/components/ui/skeleton";

const DEVICE_ICON = { Telefòn: Smartphone, Tablèt: Tablet, Òdinatè: Laptop } as const;

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "Kounye a";
  if (min < 60) return `Sa gen ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `Sa gen ${h} è`;
  const d = Math.round(h / 24);
  return `Sa gen ${d} jou`;
}

/**
 * Shared "Sessions actives" section — mounted from every role's profile
 * page (customer/driver/restaurant/admin all share the same component,
 * see useActiveSessions.ts for why each action either calls
 * revoke_my_session_secure or the official signOut({scope:"others"})).
 */
export function ActiveSessionsSection() {
  const { sessions, revokeOne, revokeOthers } = useActiveSessions();
  const { requestConfirm, ConfirmDialog } = useConfirmDialog();

  const rows = sessions.data ?? [];
  const hasOtherSessions = rows.some((s) => !s.is_current);

  function confirmRevokeOne(id: string) {
    requestConfirm(
      "Dekonekte aparèy sa a? W ap oblije konekte ankò sou li pou itilize NK Deliveri.",
      () => revokeOne.mutate(id),
    );
  }

  function confirmRevokeOthers() {
    requestConfirm(
      "Dekonekte tout lòt aparèy yo? Sa p ap afekte sesyon w ap itilize kounye a.",
      () => revokeOthers.mutate(),
    );
  }

  return (
    <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-brand-xs">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-ink">Sesyon aktif</h2>
        {hasOtherSessions && (
          <button
            onClick={confirmRevokeOthers}
            disabled={revokeOthers.isPending}
            className="inline-flex items-center gap-1.5 rounded-full border-2 border-brand-soft bg-white px-3 py-2 text-xs font-bold text-ink-soft hover:border-brand hover:text-brand-deep disabled:opacity-50"
          >
            <ShieldOff className="h-3.5 w-3.5" /> Dekonekte lòt aparèy yo
          </button>
        )}
      </div>

      {sessions.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      )}

      {!sessions.isLoading && rows.length === 0 && (
        <p className="text-sm text-ink-soft">Pa gen okenn sesyon aktif pou kounye a.</p>
      )}

      <ul className="space-y-2">
        {rows.map((s) => {
          const { device, browser, os } = parseUserAgent(s.user_agent);
          const Icon = DEVICE_ICON[device as keyof typeof DEVICE_ICON] ?? Laptop;
          return (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-xl bg-brand-soft/20 px-3 py-2.5"
            >
              <div className="flex items-center gap-3">
                <Icon className="h-5 w-5 shrink-0 text-brand-deep" aria-hidden="true" />
                <div className="text-sm">
                  <div className="flex items-center gap-1.5 font-semibold text-ink">
                    {browser} · {os}
                    {s.is_current && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                        Sesyon aktyèl
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-ink-soft">
                    {s.ip ? `${s.ip} · ` : ""}
                    Dènye aktivite: {timeAgo(s.refreshed_at ?? s.created_at)}
                  </div>
                </div>
              </div>
              {!s.is_current && (
                <button
                  onClick={() => confirmRevokeOne(s.id)}
                  disabled={revokeOne.isPending}
                  aria-label="Dekonekte aparèy sa a"
                  title="Dekonekte aparèy sa a"
                  className="shrink-0 rounded-full p-2 text-ink-soft transition hover:bg-white hover:text-red-600 disabled:opacity-50"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {ConfirmDialog}
    </section>
  );
}
