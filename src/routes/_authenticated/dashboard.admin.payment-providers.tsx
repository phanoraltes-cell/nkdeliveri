import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CreditCard } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  updatePaymentProviderSetting,
  type CheckoutProviderId,
} from "@/lib/payment-provider-availability";
import { Badge } from "@/components/ui/badge";
import { useReauth, isStepUpError } from "@/hooks/useReauth";
import { ReauthDialog } from "@/components/reauth-dialog";

// Role guard lives on the parent layout (dashboard.admin.tsx), same
// convention as every other admin route in this section.
export const Route = createFileRoute("/_authenticated/dashboard/admin/payment-providers")({
  component: AdminPaymentProviders,
});

const PROVIDER_LABELS: Record<CheckoutProviderId, string> = {
  kach: "Kach nan livrezon",
  moncash: "MonCash Manyèl",
  natcash: "NatCash",
  moncash_auto: "MonCash Otomatik",
  natcash_auto: "NatCash Otomatik",
  stripe: "Kat Kredi (Stripe)",
  wallet: "Wallet",
};

type ProviderSettingRow = {
  id: string;
  provider: string;
  visible: boolean;
  enabled: boolean;
  default_provider: boolean;
  maintenance_message: string | null;
  updated_at: string;
};

function AdminPaymentProviders() {
  const qc = useQueryClient();
  const [draftMessages, setDraftMessages] = useState<Record<string, string>>({});
  const { withReauth, invalidateStepUp, dialogState } = useReauth();

  // update_payment_provider_setting_secure is STRICT tier regardless of
  // which fields change — global payment-security configuration (see
  // docs/archive/audits/ADMIN_ACCESS_SECURITY_REMEDIATION_REPORT.md).
  function onStepUpAwareError(e: Error) {
    if (isStepUpError(e)) {
      invalidateStepUp("strict");
      toast.error("Verifikasyon sekirite ekspire — klike ankò pou re-verifye.");
      return;
    }
    toast.error(e.message ?? "Erè");
  }

  // Admin needs more columns (id, updated_at) than the checkout-facing
  // usePaymentProviderAvailability hook fetches — a separate, richer
  // read, but every *write* still goes through the single
  // updatePaymentProviderSetting() function (payment-provider-
  // availability.ts), never a second RPC call site.
  const settings = useQuery({
    queryKey: ["admin-payment-provider-settings"],
    queryFn: async (): Promise<ProviderSettingRow[]> => {
      const { data, error } = await supabase
        .from("payment_provider_settings")
        .select("id, provider, visible, enabled, default_provider, maintenance_message, updated_at")
        .order("provider");
      if (error) throw error;
      return data ?? [];
    },
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["admin-payment-provider-settings"] });
    // The checkout-facing hook shares this exact query key structure by
    // convention elsewhere in this codebase, but has its own key
    // ("payment-provider-settings") — invalidate it too so a change made
    // here is reflected on /checkout without waiting for its staleTime.
    qc.invalidateQueries({ queryKey: ["payment-provider-settings"] });
  }

  // `visible` itself is still wired end-to-end (RPC, RLS, this mutation) —
  // only the checkout page's own rendering never reads it yet (audit
  // finding, docs/archive/payments/PAYMENT_POST_INCIDENT_AUDIT.md "Bug confirmé n°3":
  // checkout.tsx only ever gates on `.enabled`). Toggling this control
  // today silently has zero effect on what a customer can see or select,
  // so the control itself is disabled here (post-incident remediation,
  // docs/archive/payments/PAYMENT_POST_INCIDENT_REMEDIATION_REPORT.md) rather than left to
  // imply a working "hide from customers" feature that doesn't exist yet
  // — least-risk fix (no checkout/business-logic change) until a future
  // chantier actually wires checkout.tsx to respect it.
  const toggleVisible = useMutation({
    mutationFn: (row: ProviderSettingRow) =>
      updatePaymentProviderSetting(supabase, row.provider as CheckoutProviderId, {
        visible: !row.visible,
      }),
    onSuccess: (_data, row) => {
      toast.success(row.visible ? "Metòd la kache" : "Metòd la vizib");
      invalidate();
    },
    onError: (e) => toast.error(e.message ?? "Erè"),
  });

  const toggleEnabled = useMutation({
    mutationFn: (row: ProviderSettingRow) =>
      updatePaymentProviderSetting(supabase, row.provider as CheckoutProviderId, {
        enabled: !row.enabled,
      }),
    onSuccess: (_data, row) => {
      toast.success(row.enabled ? "Metòd la dezaktive" : "Metòd la aktive");
      invalidate();
    },
    onError: onStepUpAwareError,
  });

  const setDefault = useMutation({
    mutationFn: (row: ProviderSettingRow) =>
      updatePaymentProviderSetting(supabase, row.provider as CheckoutProviderId, {
        setAsDefault: true,
      }),
    onSuccess: () => {
      toast.success("Nouvo metòd default anrejistre");
      invalidate();
    },
    onError: onStepUpAwareError,
  });

  const saveMessage = useMutation({
    mutationFn: (row: ProviderSettingRow) =>
      updatePaymentProviderSetting(supabase, row.provider as CheckoutProviderId, {
        // An empty draft explicitly clears the message (empty string ->
        // NULL server-side) — see update_payment_provider_setting_secure's
        // own comment for why NULL itself can't be used to mean "clear".
        maintenanceMessage: draftMessages[row.provider] ?? row.maintenance_message ?? "",
      }),
    onSuccess: () => {
      toast.success("Mesaj anrejistre");
      invalidate();
    },
    onError: onStepUpAwareError,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-display text-3xl font-extrabold text-ink">
            <CreditCard className="h-7 w-7 text-brand-deep" /> Fournisseurs
          </h1>
          <p className="mt-1 text-ink-soft">
            Kontwole ki metòd peman kliyan yo ka wè epi itilize nan checkout. Sa a se sèl kote ki
            deside disponibilite reyèl la — backend lan respekte l menm si yon moun manipile
            navigatè a.
          </p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <section className="space-y-4">
        {settings.isLoading ? (
          <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 text-sm text-ink-soft">
            Chajman…
          </div>
        ) : (
          settings.data?.map((row) => (
            <div
              key={row.id}
              className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-lg font-bold text-ink">
                    {PROVIDER_LABELS[row.provider as CheckoutProviderId] ?? row.provider}
                  </h2>
                  {row.default_provider && <Badge variant="default">Default</Badge>}
                  {!row.visible && (
                    <Badge variant="outline" title="San efè sou paj checkout la pou kounye a">
                      Kache (san efè kounye a)
                    </Badge>
                  )}
                  {!row.enabled && <Badge variant="destructive">Dezaktive</Badge>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => toggleVisible.mutate(row)}
                    disabled
                    title="Poko gen efè sou paj checkout la — sèl 'Aktive/Dezaktive' kontwole sa kliyan yo ka itilize jodi a"
                    className="cursor-not-allowed rounded-lg border-2 border-brand-soft/60 px-3 py-1 text-xs font-bold text-ink-soft opacity-60"
                  >
                    {row.visible ? "Kache" : "Fè l vizib"} (pa aktive)
                  </button>
                  <button
                    onClick={() => withReauth(() => toggleEnabled.mutate(row), "strict")}
                    disabled={toggleEnabled.isPending}
                    className="rounded-lg border-2 border-brand-soft px-3 py-1 text-xs font-bold text-brand-deep hover:bg-brand-soft/40"
                  >
                    {row.enabled ? "Dezaktive" : "Aktive"}
                  </button>
                  <button
                    onClick={() => withReauth(() => setDefault.mutate(row), "strict")}
                    disabled={row.default_provider || setDefault.isPending}
                    className="rounded-lg border-2 border-brand-soft px-3 py-1 text-xs font-bold text-brand-deep hover:bg-brand-soft/40 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Fè l default
                  </button>
                </div>
              </div>

              <div className="mt-4">
                <label
                  htmlFor={`msg-${row.id}`}
                  className="mb-1 block text-xs font-bold uppercase text-ink-soft"
                >
                  Mesaj antretyen (montre lè metòd la dezaktive)
                </label>
                <div className="flex flex-wrap gap-2">
                  <input
                    id={`msg-${row.id}`}
                    value={draftMessages[row.provider] ?? row.maintenance_message ?? ""}
                    onChange={(e) =>
                      setDraftMessages((prev) => ({ ...prev, [row.provider]: e.target.value }))
                    }
                    placeholder="Mesaj pou kliyan wè…"
                    className="min-w-0 flex-1 rounded-lg border-2 border-brand-soft bg-white px-3 py-2 text-sm outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
                  />
                  <button
                    onClick={() => withReauth(() => saveMessage.mutate(row), "strict")}
                    disabled={saveMessage.isPending}
                    className="rounded-lg bg-brand-deep px-3 py-2 text-xs font-bold text-white hover:bg-brand-deep-hover"
                  >
                    Sove
                  </button>
                </div>
              </div>

              <div className="mt-3 text-xs text-ink-soft">
                Dènye chanjman: {new Date(row.updated_at).toLocaleString("fr-HT")}
              </div>
            </div>
          ))
        )}
      </section>
      <ReauthDialog state={dialogState} />
    </div>
  );
}
