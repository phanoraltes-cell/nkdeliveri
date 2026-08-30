import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Flag, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { sendReportOpenedPush } from "@/lib/send-report-push.functions";
import { assertValidUploadFile } from "@/lib/file-validation";
import { inputClsCompact } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { ReportThread } from "@/components/reports/report-thread";
import {
  REPORT_REASON_CODES,
  REPORT_STATUS_LABEL,
  REPORT_STATUS_TONE,
  REPORT_TARGET_LABEL,
  REPORT_RESOLUTION_LABEL,
  reportReasonLabel,
} from "@/lib/report-status";

// "chak kòmand ki livre oswa anile" — pi restriktif espre pase
// DisputeSection's own eligibility (ki pèmèt plizyè estati anvan final la):
// yon siyalman se yon plent APRE FÈ, pa yon zouti pou pwoblèm an kou
// (DisputeSection deja kouvri sa). De règ separe pou de bezwen separe.
const REPORT_ELIGIBLE_STATUSES = new Set(["delivered", "cancelled"]);
const REPORT_WINDOW_DAYS = 7;
const MAX_EVIDENCE = 3;

type TargetChoice = "restaurant" | "courier" | "both";

type ReportSectionProps = {
  orderId: string;
  orderStatus: string;
  /** Order's own `updated_at` — moman li antre nan estati final la, itilize pou kalkile delè 7 jou kliyan an SOU FRONTEND (mesaj kout sèlman; sèvè a fè menm verifikasyon an reyèlman). */
  orderUpdatedAt: string;
};

/** Order-detail page's "Gen yon pwoblèm ak kòmand sa a" card — Tach 1 (SIYALMAN), separe de DisputeSection. */
export function ReportSection({ orderId, orderStatus, orderUpdatedAt }: ReportSectionProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const sendOpenedPush = useServerFn(sendReportOpenedPush);
  const [formOpen, setFormOpen] = useState(false);
  const [target, setTarget] = useState<TargetChoice>("restaurant");
  const [reasonRestaurant, setReasonRestaurant] = useState(REPORT_REASON_CODES.restaurant[0].value);
  const [reasonCourier, setReasonCourier] = useState(REPORT_REASON_CODES.courier[0].value);
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const reports = useQuery({
    queryKey: ["order-reports", orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reports")
        .select("id, target_type, reason_code, status, admin_note, resolution, created_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const eligible = REPORT_ELIGIBLE_STATUSES.has(orderStatus);
  const withinWindow =
    Date.now() - new Date(orderUpdatedAt).getTime() < REPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const activeTargets = new Set(
    (reports.data ?? [])
      .filter((r) => r.status === "open" || r.status === "reviewing")
      .map((r) => r.target_type),
  );
  const canOpenAnyNew = activeTargets.size < 2;

  const submit = useMutation({
    mutationFn: async () => {
      if (description.trim().length < 20) {
        throw new Error("Deskripsyon an dwe gen omwen 20 karaktè");
      }
      if (!user) throw new Error("Ou dwe konekte");

      // Upload prèv yo YON SÈL fwa — pataje ant 1 oswa 2 dosye kreye pi ba
      // (menm foto yo si "Tou de" chwazi, pa depoze 2 fwa menm fichye a).
      const evidenceUrls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        assertValidUploadFile(file, "report-evidence");
        const path = `${user.id}/${Date.now()}-${i}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
        const { error } = await supabase.storage.from("report-evidence").upload(path, file, {
          upsert: false,
        });
        if (error) throw error;
        evidenceUrls.push(path);
      }

      const targets: { targetType: "restaurant" | "courier"; reasonCode: string }[] =
        target === "both"
          ? [
              { targetType: "restaurant", reasonCode: reasonRestaurant },
              { targetType: "courier", reasonCode: reasonCourier },
            ]
          : [
              {
                targetType: target,
                reasonCode: target === "restaurant" ? reasonRestaurant : reasonCourier,
              },
            ];

      const results = [];
      for (const t of targets) {
        const { data, error } = await supabase.rpc("create_report_secure", {
          _order_id: orderId,
          _target_type: t.targetType,
          _reason_code: t.reasonCode,
          _description: description.trim(),
          _evidence_urls: evidenceUrls,
        });
        if (error) throw error;
        results.push(data);
        // TACH 2 — push bay admin sèlman pou dosye REYÈLMAN nouvo (pa lè
        // RPC la retounen yon dosye ki te deja egziste, wè kòmantè
        // "anyExisting" pi ba pou menm mezi-tan an).
        if (Date.now() - new Date(data.created_at).getTime() < 5000) {
          try {
            await sendOpenedPush({ data: { reportId: data.id } });
          } catch (e) {
            console.warn("push send failed", e);
          }
        }
      }
      return results;
    },
    onSuccess: (results) => {
      // Yon ranje ki gen plis pase kèk segond deja egziste anvan apèl sa a
      // — RPC la retounen dosye ki deja la a olye kreye yon lòt.
      const anyExisting = results.some((r) => Date.now() - new Date(r.created_at).getTime() > 5000);
      toast.success(
        anyExisting
          ? "Ou gen deja yon dosye aktif — men enfòmasyon li anba a."
          : `Siyalman voye ak siksè (${results.length > 1 ? "2 dosye" : "1 dosye"}).`,
      );
      setDescription("");
      setFiles([]);
      setFormOpen(false);
      qc.invalidateQueries({ queryKey: ["order-reports", orderId] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (!eligible) return null;

  return (
    <div className="rounded-2xl bg-white p-5 shadow-brand-xs ring-1 ring-brand-soft/40">
      <div className="flex items-center gap-2 font-display text-base font-bold">
        <Flag className="h-4 w-4 text-brand-deep" /> Gen yon pwoblèm ak kòmand sa a?
      </div>

      {reports.data?.map((r) => (
        <div key={r.id} className="mt-3 rounded-xl border border-brand-soft/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-bold text-ink">
              Dosye #{r.id.slice(0, 8)} — {REPORT_TARGET_LABEL[r.target_type]}
            </span>
            <StatusBadge tone={REPORT_STATUS_TONE[r.status] ?? "neutral"}>
              {REPORT_STATUS_LABEL[r.status] ?? r.status}
            </StatusBadge>
          </div>
          <p className="mt-1 text-xs text-ink-soft">
            {reportReasonLabel(r.target_type, r.reason_code)}
          </p>
          {r.admin_note && (
            <p className="mt-1 text-sm text-ink">
              <b>Repons admin :</b> {r.admin_note}
            </p>
          )}
          {r.status === "resolved" && r.resolution !== "none" && (
            <p className="mt-1 text-xs text-ink-soft">
              Rezolisyon : {REPORT_RESOLUTION_LABEL[r.resolution] ?? r.resolution}
            </p>
          )}
          <ReportThread reportId={r.id} status={r.status} />
        </div>
      ))}

      {!withinWindow && (reports.data?.length ?? 0) === 0 && (
        <p className="mt-3 text-xs text-ink-soft">
          Delè 7 jou pou siyale yon pwoblèm sou kòmand sa a pase.
        </p>
      )}

      {withinWindow && canOpenAnyNew && (
        <div className="mt-3">
          {!formOpen ? (
            <Button variant="outline" onClick={() => setFormOpen(true)}>
              <Flag className="h-3.5 w-3.5" /> Siyale yon pwoblèm
            </Button>
          ) : (
            <div className="space-y-3 rounded-xl bg-cream p-3">
              <div>
                <span className="mb-1 block text-xs font-bold text-ink-soft">Kont ki moun?</span>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["restaurant", "Restoran"],
                      ["courier", "Livrè"],
                      ["both", "Tou de"],
                    ] as [TargetChoice, string][]
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setTarget(value)}
                      className={`rounded-full border-2 px-3 py-1.5 text-xs font-bold transition ${
                        target === value
                          ? "border-brand bg-brand text-white"
                          : "border-brand-soft bg-white text-ink-soft"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {(target === "restaurant" || target === "both") && (
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-ink-soft">
                    Rezon (Restoran)
                  </span>
                  <select
                    value={reasonRestaurant}
                    onChange={(e) => setReasonRestaurant(e.target.value)}
                    className={inputClsCompact()}
                  >
                    {REPORT_REASON_CODES.restaurant.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {(target === "courier" || target === "both") && (
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-ink-soft">Rezon (Livrè)</span>
                  <select
                    value={reasonCourier}
                    onChange={(e) => setReasonCourier(e.target.value)}
                    className={inputClsCompact()}
                  >
                    {REPORT_REASON_CODES.courier.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="block">
                <span className="mb-1 block text-xs font-bold text-ink-soft">
                  Eksplike pwoblèm nan (omwen 20 karaktè)
                </span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder="Eksplike sa k pase a…"
                  className={inputClsCompact()}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-bold text-ink-soft">
                  Prèv (opsyonèl, jiska {MAX_EVIDENCE} foto)
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []).slice(0, MAX_EVIDENCE);
                    setFiles(picked);
                  }}
                  className="block w-full text-xs text-ink-soft file:mr-2 file:rounded-full file:border-0 file:bg-brand-soft/60 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-brand-deep"
                />
                {files.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {files.map((f, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[11px] text-ink-soft ring-1 ring-brand-soft/40"
                      >
                        {f.name}
                        <button
                          type="button"
                          onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                          aria-label={`Retire ${f.name}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </label>

              <div className="flex gap-2">
                <Button
                  disabled={submit.isPending || description.trim().length < 20}
                  isLoading={submit.isPending}
                  onClick={() => submit.mutate()}
                >
                  Voye siyalman an
                </Button>
                <Button variant="outline" onClick={() => setFormOpen(false)}>
                  Anile
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
