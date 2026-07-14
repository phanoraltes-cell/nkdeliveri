import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Bell, Check, CheckCircle2, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import { PushToggle } from "@/components/push-toggle";

export const Route = createFileRoute("/_authenticated/notifications")({
  component: NotificationsPage,
});

function NotificationsPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["my-notifications", user?.id],
    queryFn: async () => {
      // RLS ("notif own") already scopes every row to auth.uid(), so this
      // filter can't change what comes back — it's here so the query reads
      // "my notifications" on its own and stays correct if that policy is
      // ever loosened (e.g. to let a role read others' rows) without this
      // file being touched.
      const { data, error } = await supabase
        .from("notifications")
        .select("id, type, title, body, data, read_at, created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const markRead = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .in("id", ids)
        .is("read_at", null);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-notifications"] }),
    onError: (e) => toast.error(e.message),
  });

  const unread = (data ?? []).filter((n) => !n.read_at);

  function iconFor(type: string) {
    if (type === "payment_paid") return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
    if (type === "payment_failed") return <XCircle className="h-5 w-5 text-red-600" />;
    if (type === "payment_under_review") return <Clock className="h-5 w-5 text-amber-600" />;
    return <Bell className="h-5 w-5 text-brand-deep" />;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Notifikasyon</h1>
          <p className="mt-1 text-ink-soft">{unread.length} nouvo</p>
        </div>
        <PushToggle />
      </div>
      <div className="flex items-center justify-end">
        {unread.length > 0 && (
          <button
            onClick={() => markRead.mutate(unread.map((n) => n.id))}
            className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-3 py-2.5 text-xs font-bold text-brand-deep hover:bg-brand hover:text-white"
          >
            <Check className="h-3.5 w-3.5" /> Make tout kòm li
          </button>
        )}
      </div>

      {isLoading && <div className="text-ink-soft">Chajman…</div>}
      {data?.length === 0 && (
        <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 text-center text-ink-soft">
          Pa gen notifikasyon toujou.
        </div>
      )}

      <ul className="space-y-2">
        {data?.map((n) => {
          const orderId = (n.data as { order_id?: string } | null)?.order_id;
          const inner = (
            <div
              className={`flex gap-3 rounded-2xl border p-4 transition ${
                n.read_at ? "border-brand-soft/40 bg-white" : "border-brand/40 bg-brand-soft/30"
              }`}
            >
              <div className="mt-0.5">{iconFor(n.type)}</div>
              <div className="flex-1">
                <div className="font-bold text-ink">{n.title}</div>
                <div className="text-sm text-ink-soft">{n.body}</div>
                <div className="mt-1 text-[11px] uppercase tracking-wider text-ink-soft">
                  {new Date(n.created_at).toLocaleString("fr-HT")}
                </div>
              </div>
              {!n.read_at && (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    markRead.mutate([n.id]);
                  }}
                  className="self-start rounded-full bg-white px-2 py-1 text-[10px] font-bold text-brand-deep hover:bg-brand hover:text-white"
                >
                  Li
                </button>
              )}
            </div>
          );
          return (
            <li key={n.id}>
              {orderId ? (
                <Link
                  to="/orders/$id"
                  params={{ id: orderId }}
                  onClick={() => !n.read_at && markRead.mutate([n.id])}
                >
                  {inner}
                </Link>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
