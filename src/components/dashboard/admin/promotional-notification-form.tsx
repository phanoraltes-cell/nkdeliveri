import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { inputClsCompact as inputCls } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const TARGET_LABEL: Record<string, string> = {
  all: "Tout itilizatè",
  customer: "Sèlman kliyan",
  restaurant_owner: "Sèlman restoran",
  driver: "Sèlman livrè",
};

/**
 * Sends a targeted promotional in-app/push notification via
 * send_promotional_notification_secure — distinct from sponsored
 * placements below (on-page ad cards). Server-side, this only ever
 * reaches users who opted into the "promotion" category and haven't
 * received one within the cooldown window, regardless of what's
 * submitted here — this form just chooses title/body/audience.
 */
export function PromotionalNotificationForm() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [targetRole, setTargetRole] = useState("all");
  const [targetCity, setTargetCity] = useState("");

  const send = useMutation({
    mutationFn: async () => {
      if (!title.trim() || !body.trim()) throw new Error("Ranpli tit ak kontni mesaj la");
      const { data, error } = await supabase.rpc("send_promotional_notification_secure", {
        _title: title.trim(),
        _body: body.trim(),
        _target_role: targetRole,
        _target_city: targetCity.trim() || undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      toast.success(`Voye bay ${row?.recipient_count ?? 0} itilizatè`);
      setTitle("");
      setBody("");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="font-display text-sm font-bold text-ink">
          Voye notifikasyon pwomosyonèl
        </span>
        <span className="text-xs font-bold text-brand-deep">{open ? "Fèmen" : "Louvri"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Tit"
            aria-label="Tit"
            className={inputCls()}
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Kontni mesaj la…"
            aria-label="Kontni mesaj la…"
            rows={2}
            className={inputCls()}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={targetRole}
              onChange={(e) => setTargetRole(e.target.value)}
              aria-label="Sib"
              className={inputCls()}
            >
              {Object.entries(TARGET_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input
              value={targetCity}
              onChange={(e) => setTargetCity(e.target.value)}
              placeholder="Vil/zòn (opsyonèl)"
              aria-label="Vil/zòn (opsyonèl)"
              className={inputCls()}
            />
          </div>
          <Button disabled={send.isPending} onClick={() => send.mutate()}>
            <Send className="h-4 w-4" /> {send.isPending ? "Ap voye…" : "Voye notifikasyon"}
          </Button>
        </div>
      )}
    </div>
  );
}
