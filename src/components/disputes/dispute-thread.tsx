import { useState } from "react";
import { Send } from "lucide-react";
import { useDisputeMessages } from "@/hooks/useDisputeMessages";
import { StatusBadge } from "@/components/dashboard/status-badge";

const AUTHOR_ROLE_LABEL: Record<string, string> = {
  customer: "Kliyan",
  restaurant: "Restoran",
  driver: "Livrè",
  admin: "Admin",
};

type DisputeThreadProps = {
  disputeId: string;
  status: "open" | "resolved";
  resolution?: string | null;
  /** Only the admin dashboard passes this — renders the final-ruling form. */
  canResolve?: boolean;
  onResolve?: (resolution: string) => void;
  isResolving?: boolean;
};

/** Message thread + reply box for one dispute — shared by the customer, restaurant, driver and admin dashboards. */
export function DisputeThread({
  disputeId,
  status,
  resolution,
  canResolve,
  onResolve,
  isResolving,
}: DisputeThreadProps) {
  const { messages, send } = useDisputeMessages(disputeId);
  const [reply, setReply] = useState("");
  const [resolutionText, setResolutionText] = useState("");

  return (
    <div className="mt-3 space-y-3">
      <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl bg-cream p-3">
        {messages.isLoading && (
          <div className="space-y-2">
            <div className="h-14 animate-pulse rounded-lg bg-white/70" />
            <div className="h-14 animate-pulse rounded-lg bg-white/70" />
          </div>
        )}
        {messages.data?.map((m) => (
          <div key={m.id} className="rounded-lg bg-white p-2.5 text-sm shadow-brand-xs">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-brand-deep">
                {AUTHOR_ROLE_LABEL[m.author_role] ?? m.author_role}
              </span>
              <span className="text-[11px] text-ink-soft">
                {new Date(m.created_at).toLocaleString("fr-HT")}
              </span>
            </div>
            <p className="text-ink">{m.message}</p>
          </div>
        ))}
      </div>

      {status === "resolved" ? (
        <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
          <StatusBadge tone="good">Rezoud</StatusBadge>
          {resolution && <p className="mt-2">{resolution}</p>}
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Ekri yon repons…"
              className="flex-1 rounded-full border-2 border-brand-soft bg-white px-3 py-2.5 text-sm outline-none transition-[border-color,box-shadow] duration-150 focus:border-brand focus:shadow-brand-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter" && reply.trim()) {
                  send.mutate(reply.trim());
                  setReply("");
                }
              }}
            />
            <button
              disabled={send.isPending || !reply.trim()}
              onClick={() => {
                send.mutate(reply.trim());
                setReply("");
              }}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-brand-xs transition hover:scale-110 hover:bg-brand-deep disabled:pointer-events-none disabled:opacity-50"
              aria-label="Voye"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>

          {canResolve && (
            <div className="rounded-xl border-2 border-dashed border-brand-soft p-3">
              <label className="mb-1 block text-xs font-bold uppercase text-ink-soft">
                Rezolisyon final (admin)
              </label>
              <textarea
                value={resolutionText}
                onChange={(e) => setResolutionText(e.target.value)}
                rows={2}
                placeholder="Eksplike desizyon final la…"
                className="w-full rounded-xl border-2 border-brand-soft bg-white px-3 py-2 text-sm outline-none focus:border-brand"
              />
              <button
                disabled={isResolving || resolutionText.trim().length < 3}
                onClick={() => {
                  onResolve?.(resolutionText.trim());
                  setResolutionText("");
                }}
                className="mt-2 rounded-full bg-brand-deep px-4 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
              >
                {isResolving ? "Ap rezoud…" : "Rezoud litij la"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
