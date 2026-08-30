import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { ProofThumb } from "@/components/proof-thumb";
import { ReportThread } from "@/components/reports/report-thread";
import { inputClsCompact } from "@/lib/utils";
import {
  REPORT_STATUS_LABEL,
  REPORT_STATUS_TONE,
  REPORT_TARGET_LABEL,
  REPORT_RESOLUTION_LABEL,
  REPORT_TERMINAL_STATUSES,
  reportReasonLabel,
} from "@/lib/report-status";
import type { Database } from "@/integrations/supabase/types";

export type ReportAdminDetail =
  Database["public"]["Functions"]["get_reports_admin"]["Returns"][number];

type ReportDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: ReportAdminDetail | null;
  onSetStatus: (status: "open" | "reviewing", note: string) => void;
  onReject: (note: string) => void;
  onResolve: (resolution: string, note: string) => void;
  onRequestExplanation: (question: string) => void;
  isBusy: boolean;
};

const RESOLUTION_OPTIONS = ["none", "warning", "refund", "partial_refund", "suspension"] as const;

/**
 * Detay konplè yon dosye siyalman pou admin — sèl kote tout enfòmasyon an
 * (kliyan, sib, prèv foto, istorik sib la) vizib ansanm. Aksyon yo mennen
 * DIREKTEMAN nan RPC ki DEJA egziste pou konsekans operasyonèl yo
 * (sispansyon = update_driver/restaurant_status_secure — wè migrasyon
 * 20260830140000 pou detay/limit sou "ranbouse").
 */
export function ReportDetailDialog({
  open,
  onOpenChange,
  report,
  onSetStatus,
  onReject,
  onResolve,
  onRequestExplanation,
  isBusy,
}: ReportDetailDialogProps) {
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState<string>("warning");
  const [question, setQuestion] = useState("");

  if (!report) return null;
  const isTerminal = REPORT_TERMINAL_STATUSES.has(report.status);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            #{report.id.slice(0, 8)} — {report.order_number}
            <StatusBadge tone="neutral">{REPORT_TARGET_LABEL[report.target_type]}</StatusBadge>
            <StatusBadge tone={REPORT_STATUS_TONE[report.status] ?? "neutral"}>
              {REPORT_STATUS_LABEL[report.status] ?? report.status}
            </StatusBadge>
          </DialogTitle>
          <DialogDescription>
            {report.target_name} · {reportReasonLabel(report.target_type, report.reason_code)} ·{" "}
            {new Date(report.created_at).toLocaleString("fr-HT")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-1 text-sm">
          <div>
            <span className="text-ink-soft">Kliyan :</span>{" "}
            <span className="font-bold text-ink">{report.reporter_email ?? "—"}</span>
          </div>
          <div>
            <span className="text-ink-soft">Montan kòmand :</span>{" "}
            <span className="font-bold text-ink">{report.order_total} HTG</span>
          </div>
          <div className="flex items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
            <span className="text-ink-soft">
              Siyalman fonde (90 dènye jou) sou{" "}
              {REPORT_TARGET_LABEL[report.target_type].toLowerCase()} sa a :
            </span>
            <span className="font-bold text-ink">{report.target_founded_reports_90d}</span>
          </div>
        </div>

        <div className="rounded-xl bg-cream p-3 text-sm text-ink">{report.description}</div>

        {report.evidence_urls.length > 0 && (
          <div>
            <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">Prèv</span>
            <div className="flex flex-wrap gap-2">
              {report.evidence_urls.map((path) => (
                <ProofThumb key={path} path={path} bucket="report-evidence" alt="Prèv siyalman" />
              ))}
            </div>
          </div>
        )}

        {report.shared_with_target_at && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
            <p className="font-bold text-amber-900">Dosye pataje ak sib la</p>
            {report.target_explanation_question && (
              <p className="mt-1 text-ink">
                <b>Kesyon:</b> {report.target_explanation_question}
              </p>
            )}
            {report.target_explanation ? (
              <p className="mt-1 text-ink">
                <b>Repons sib la:</b> {report.target_explanation}
              </p>
            ) : (
              <p className="mt-1 text-ink-soft">Ap tann repons sib la…</p>
            )}
          </div>
        )}

        <section>
          <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
            Mesaj ak kliyan an
          </span>
          <ReportThread reportId={report.id} status={report.status} />
        </section>

        {!isTerminal && (
          <section className="space-y-3 border-t border-brand-soft/40 pt-4">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className={inputClsCompact()}
              placeholder="Nòt admin (opsyonèl)…"
            />

            <div className="flex flex-wrap gap-2">
              {report.status === "open" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isBusy}
                  onClick={() => onSetStatus("reviewing", note.trim())}
                >
                  Mete anba etid
                </Button>
              )}
              <Button
                size="sm"
                variant="destructive"
                disabled={isBusy}
                onClick={() => onReject(note.trim())}
              >
                Rejte
              </Button>
            </div>

            {!report.shared_with_target_at && (
              <div className="rounded-xl bg-white p-3 ring-1 ring-brand-soft/40">
                <label className="mb-1 block text-xs font-bold uppercase text-ink-soft">
                  Mande yon eksplikasyon bay {REPORT_TARGET_LABEL[report.target_type].toLowerCase()}{" "}
                  a
                </label>
                <p className="mb-2 text-xs text-ink-soft">
                  Sa a pataje kòmand#/rezon/deskripsyon (JAMÈ idantite kliyan an) ak sib la.
                </p>
                <div className="flex gap-2">
                  <input
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Kesyon pou sib la (opsyonèl)…"
                    aria-label="Kesyon pou sib la"
                    className={inputClsCompact()}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() => onRequestExplanation(question.trim())}
                  >
                    Mande
                  </Button>
                </div>
              </div>
            )}

            <div className="rounded-xl bg-white p-3 ring-1 ring-brand-soft/40">
              <label className="mb-1 block text-xs font-bold uppercase text-ink-soft">
                Rezoud ak yon rezolisyon
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  className={inputClsCompact()}
                >
                  {RESOLUTION_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {REPORT_RESOLUTION_LABEL[r]}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  disabled={isBusy}
                  onClick={() => onResolve(resolution, note.trim())}
                >
                  Rezoud dosye a
                </Button>
              </div>
              {resolution === "suspension" && (
                <p className="mt-1.5 text-xs text-amber-700">
                  Sa a sispann {REPORT_TARGET_LABEL[report.target_type].toLowerCase()} a imedyatman
                  (update_{report.target_type === "courier" ? "driver" : "restaurant"}
                  _status_secure).
                </p>
              )}
              {(resolution === "refund" || resolution === "partial_refund") && (
                <p className="mt-1.5 text-xs text-ink-soft">
                  Anrejistre klasifikasyon an sèlman — itilize zouti Ranbousman kòmand la separeman
                  pou reyèlman trete lajan an.
                </p>
              )}
            </div>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
