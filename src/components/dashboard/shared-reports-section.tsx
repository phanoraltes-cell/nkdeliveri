import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlertTriangle, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { Button } from "@/components/ui/button";
import { inputClsCompact } from "@/lib/utils";
import {
  REPORT_STATUS_LABEL,
  REPORT_STATUS_TONE,
  REPORT_TARGET_LABEL,
  reportReasonLabel,
} from "@/lib/report-status";

/**
 * TACH 1 (SIYALMAN) — sa livrè a/restoran an wè: SÈLMAN dosye admin
 * eksplisitman deside "pataje" (get_shared_reports_for_target_secure()
 * retounen yon vèsyon FILTRE, JAMÈ idantite/kontak kliyan an — wè
 * migrasyon 20260830140000). Pataje pa dashboard.restaurant.reports.tsx
 * ak dashboard.driver.reports.tsx.
 */
export function SharedReportsSection({
  backTo,
}: {
  backTo: "/dashboard/restaurant" | "/dashboard/driver";
}) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const reports = useQuery({
    queryKey: ["shared-reports-for-target"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_shared_reports_for_target_secure");
      if (error) throw error;
      return data ?? [];
    },
  });

  const submitExplanation = useMutation({
    mutationFn: async ({ reportId, explanation }: { reportId: string; explanation: string }) => {
      const { error } = await supabase.rpc("submit_target_explanation_secure", {
        _report_id: reportId,
        _explanation: explanation,
      });
      if (error) throw error;
    },
    onSuccess: (_d, { reportId }) => {
      toast.success("Repons ou voye bay admin");
      setDrafts((d) => ({ ...d, [reportId]: "" }));
      qc.invalidateQueries({ queryKey: ["shared-reports-for-target"] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Siyalman</h1>
          <p className="mt-1 text-ink-soft">
            Dosye admin deside pataje avè w — pa gen idantite kliyan an ladan yo.
          </p>
        </div>
        <Link to={backTo} className="text-sm font-bold text-brand-deep hover:underline">
          ← Dashboard
        </Link>
      </div>

      {reports.isLoading && <div className="text-ink-soft">Chajman…</div>}

      {!reports.isLoading && (reports.data?.length ?? 0) === 0 && (
        <EmptyState
          icon={AlertTriangle}
          title="Pa gen siyalman pataje ak ou"
          description="Lè admin mande w yon eksplikasyon sou yon siyalman, li parèt isit la."
        />
      )}

      <div className="space-y-3">
        {reports.data?.map((r) => (
          <div
            key={r.id}
            className="rounded-2xl border border-brand-soft/50 bg-white p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-ink">
                Kòmand {r.order_number} — {REPORT_TARGET_LABEL[r.target_type]}
              </span>
              <StatusBadge tone={REPORT_STATUS_TONE[r.status] ?? "neutral"}>
                {REPORT_STATUS_LABEL[r.status] ?? r.status}
              </StatusBadge>
            </div>
            <p className="mt-1 text-sm text-ink-soft">
              Rezon: {reportReasonLabel(r.target_type, r.reason_code)}
            </p>
            <p className="mt-1 text-sm text-ink">{r.description}</p>

            {r.target_explanation_question && (
              <div className="mt-3 rounded-xl bg-cream p-3 text-sm">
                <b className="text-ink">Kesyon admin :</b> {r.target_explanation_question}
              </div>
            )}

            {r.target_explanation ? (
              <div className="mt-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
                <b>Repons ou :</b> {r.target_explanation}
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                <input
                  value={drafts[r.id] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                  placeholder="Ekri repons/eksplikasyon w…"
                  aria-label="Ekri repons/eksplikasyon w…"
                  className={inputClsCompact()}
                />
                <Button
                  size="icon"
                  aria-label="Voye repons"
                  disabled={submitExplanation.isPending || !(drafts[r.id] ?? "").trim()}
                  onClick={() =>
                    submitExplanation.mutate({
                      reportId: r.id,
                      explanation: (drafts[r.id] ?? "").trim(),
                    })
                  }
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
