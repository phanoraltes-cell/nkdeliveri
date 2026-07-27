import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Settings2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const CATEGORIES: { key: string; label: string; defaultOn: boolean }[] = [
  { key: "order", label: "Kòmand", defaultOn: true },
  { key: "delivery", label: "Livrezon", defaultOn: true },
  { key: "payment", label: "Peman", defaultOn: true },
  { key: "commission", label: "Komisyon", defaultOn: true },
  { key: "dispute", label: "Litij", defaultOn: true },
  { key: "promotion", label: "Pwomosyon", defaultOn: false },
  { key: "system", label: "Sistèm", defaultOn: true },
];

/**
 * Per-category in-app/push notification opt-in — every category is
 * enabled by default except promotions (opt-in only), matching how
 * private.notify_secure itself treats a missing preference key.
 */
export function NotificationPreferencesPanel({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});

  const query = useQuery({
    queryKey: ["notification-preferences", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("prefs")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return (data?.prefs as Record<string, boolean> | undefined) ?? {};
    },
  });

  useEffect(() => {
    if (query.data) setPrefs(query.data);
  }, [query.data]);

  const save = useMutation({
    mutationFn: async (next: Record<string, boolean>) => {
      const { error } = await supabase.rpc("update_notification_preferences_secure", {
        _prefs: next,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Preferans sove");
      qc.invalidateQueries({ queryKey: ["notification-preferences", userId] });
    },
    onError: (e) => toast.error(e.message),
  });

  function toggle(key: string, defaultOn: boolean) {
    const current = prefs[key] ?? defaultOn;
    const next = { ...prefs, [key]: !current };
    setPrefs(next);
    save.mutate(next);
  }

  return (
    <div className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 font-display text-sm font-bold text-ink">
          <Settings2 className="h-4 w-4 text-brand-deep" /> Preferans notifikasyon
        </span>
        <span className="text-xs font-bold text-brand-deep">{open ? "Fèmen" : "Modifye"}</span>
      </button>
      {open && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {CATEGORIES.map((c) => {
            const on = prefs[c.key] ?? c.defaultOn;
            return (
              <label key={c.key} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(c.key, c.defaultOn)}
                  disabled={save.isPending}
                />
                {c.label}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
