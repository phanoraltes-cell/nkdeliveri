import { useState } from "react";
import { Send } from "lucide-react";
import { useReportMessages } from "@/hooks/useReportMessages";
import { Button } from "@/components/ui/button";
import { inputClsCompact } from "@/lib/utils";
import { REPORT_TERMINAL_STATUSES } from "@/lib/report-status";

const AUTHOR_ROLE_LABEL: Record<string, string> = {
  customer: "Ou",
  admin: "Admin",
};

type ReportThreadProps = {
  reportId: string;
  status: string;
};

/**
 * Fil mesaj yon dosye siyalman — SÈLMAN ant kliyan an ak admin (sib la —
 * livrè/restoran — pa patisipe nan fil sa a ditou, wè migrasyon
 * 20260830140000 pou poukisa). Pataje pa order/report-section.tsx (kliyan)
 * ak dashboard.admin.reports.tsx (admin).
 */
export function ReportThread({ reportId, status }: ReportThreadProps) {
  const { messages, send } = useReportMessages(reportId);
  const [reply, setReply] = useState("");
  const locked = REPORT_TERMINAL_STATUSES.has(status);

  function submit() {
    const text = reply.trim();
    if (!text) return;
    send.mutate(text);
    setReply("");
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl bg-cream p-3">
        {messages.isLoading && <div className="h-14 animate-pulse rounded-lg bg-white/70" />}
        {messages.data?.length === 0 && (
          <p className="text-xs text-ink-soft">Pa gen mesaj toujou.</p>
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

      {!locked && (
        <div className="flex gap-2">
          <input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Ekri yon mesaj…"
            aria-label="Ekri yon mesaj…"
            className={inputClsCompact()}
          />
          <Button
            size="icon"
            disabled={send.isPending || !reply.trim()}
            onClick={submit}
            aria-label="Voye"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
