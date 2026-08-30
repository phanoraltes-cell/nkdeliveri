import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Settings2, Volume2, Vibrate } from "lucide-react";
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
        <>
          {/* P12 — still the native <input type="checkbox"> (no new
              component/dependency added, per the remediation brief), but
              each row is now a padded, rounded, hover-tinted label instead
              of bare text next to a small square. A <label> wrapping its
              <input> already makes the whole row natively clickable/
              togglable — this just makes that obvious and comfortable to
              tap (was effectively ~20px tall before, now a real ≥44px
              target), and accent-brand tints the check itself instead of
              the browser's default blue. */}
          <div className="mt-3 grid gap-1 sm:grid-cols-2">
            {CATEGORIES.map((c) => {
              const on = prefs[c.key] ?? c.defaultOn;
              return (
                <label
                  key={c.key}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-2.5 text-sm text-ink transition hover:bg-brand-soft/30"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(c.key, c.defaultOn)}
                    disabled={save.isPending}
                    className="h-4 w-4 shrink-0 accent-brand"
                  />
                  {c.label}
                </label>
              );
            })}
          </div>

          {/* Separate from the category grid above — these two apply to how a
              notification is delivered, not which ones arrive. Vibration only
              has any effect on a phone; harmless to show everywhere since it's
              simply a no-op where the hardware doesn't support it. */}
          <div className="mt-3 flex flex-wrap gap-2 border-t border-brand-soft/40 pt-3">
            <label className="flex items-center gap-2.5 rounded-lg px-2 py-2.5 text-sm text-ink transition hover:bg-brand-soft/30">
              <input
                type="checkbox"
                checked={prefs.sound ?? true}
                onChange={() => toggle("sound", true)}
                disabled={save.isPending}
                className="h-4 w-4 shrink-0 accent-brand"
              />
              <Volume2 className="h-3.5 w-3.5 text-brand-deep" /> Son
            </label>
            <label className="flex items-center gap-2.5 rounded-lg px-2 py-2.5 text-sm text-ink transition hover:bg-brand-soft/30">
              <input
                type="checkbox"
                checked={prefs.vibration ?? true}
                onChange={() => toggle("vibration", true)}
                disabled={save.isPending}
                className="h-4 w-4 shrink-0 accent-brand"
              />
              <Vibrate className="h-3.5 w-3.5 text-brand-deep" /> Vibrasyon (sou telefòn)
            </label>
          </div>

          {/* TACH 2 (siyalman E) — switch pa KANAL (olye pa tip evènman
              sèlman, grid anwo a): "Push sou telefòn" ak "SMS" — chak
              defo aktive, tou de kle nan MENM jsonb la (push_enabled/
              sms_enabled), li nan push-dispatch.server.ts/
              sms-dispatch.server.ts. "Nan sit la" pa gen switch: se
              deja toujou aktif (pa gen mwayen dezaktive afichaj in-app
              la san kache tout done a). */}
          <div className="mt-3 flex flex-wrap gap-2 border-t border-brand-soft/40 pt-3">
            <label className="flex items-center gap-2.5 rounded-lg px-2 py-2.5 text-sm text-ink transition hover:bg-brand-soft/30">
              <input
                type="checkbox"
                checked={prefs.push_enabled ?? true}
                onChange={() => toggle("push_enabled", true)}
                disabled={save.isPending}
                className="h-4 w-4 shrink-0 accent-brand"
              />
              Push sou telefòn
            </label>
            <label className="flex items-center gap-2.5 rounded-lg px-2 py-2.5 text-sm text-ink transition hover:bg-brand-soft/30">
              <input
                type="checkbox"
                checked={prefs.sms_enabled ?? true}
                onChange={() => toggle("sms_enabled", true)}
                disabled={save.isPending}
                className="h-4 w-4 shrink-0 accent-brand"
              />
              SMS (si push pa mache)
            </label>
          </div>
        </>
      )}
    </div>
  );
}
