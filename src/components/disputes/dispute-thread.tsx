import { useState } from "react";
import { Send, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { assertValidUploadFile } from "@/lib/file-validation";
import { useDisputeMessages } from "@/hooks/useDisputeMessages";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { ProofThumb } from "@/components/proof-thumb";
import { Button } from "@/components/ui/button";
import { inputClsCompact } from "@/lib/utils";
import {
  DISPUTE_STATUS_LABEL,
  DISPUTE_STATUS_TONE,
  DISPUTE_TERMINAL_STATUSES,
} from "@/lib/dispute-status";

const AUTHOR_ROLE_LABEL: Record<string, string> = {
  customer: "Kliyan",
  restaurant: "Restoran",
  driver: "Livrè",
  admin: "Admin",
};

type DisputeThreadProps = {
  disputeId: string;
  status: string;
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
  const [file, setFile] = useState<File | null>(null);
  const [internalNote, setInternalNote] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function sendReply() {
    const text = reply.trim();
    if (!text) return;
    let attachmentUrl: string | undefined;
    if (file) {
      try {
        setUploading(true);
        assertValidUploadFile(file, "dispute-attachments");
        const path = `${disputeId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
        const { error } = await supabase.storage
          .from("dispute-attachments")
          .upload(path, file, { upsert: false });
        if (error) throw error;
        // Bare storage path, like payment_proofs.file_url — ProofThumb signs
        // it fresh on every render instead of embedding a URL that expires.
        attachmentUrl = path;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Echèk voye pyès jwenn nan");
        setUploading(false);
        return;
      }
      setUploading(false);
    }
    send.mutate({ message: text, isInternal: canResolve && internalNote, attachmentUrl });
    setReply("");
    setFile(null);
    setInternalNote(false);
  }

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
          <div
            key={m.id}
            className={`rounded-lg p-2.5 text-sm shadow-brand-xs ${m.is_internal ? "bg-amber-50 ring-1 ring-amber-300" : "bg-white"}`}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-brand-deep">
                {AUTHOR_ROLE_LABEL[m.author_role] ?? m.author_role}
                {m.is_internal && <StatusBadge tone="warn">Admin sèlman</StatusBadge>}
              </span>
              <span className="text-[11px] text-ink-soft">
                {new Date(m.created_at).toLocaleString("fr-HT")}
              </span>
            </div>
            <p className="text-ink">{m.message}</p>
            {m.attachment_url && (
              <div className="mt-1.5">
                <ProofThumb path={m.attachment_url} bucket="dispute-attachments" alt="Pyès jwenn" />
              </div>
            )}
          </div>
        ))}
      </div>

      {DISPUTE_TERMINAL_STATUSES.has(status) ? (
        <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
          <StatusBadge tone={DISPUTE_STATUS_TONE[status] ?? "good"}>
            {DISPUTE_STATUS_LABEL[status] ?? status}
          </StatusBadge>
          {resolution && <p className="mt-2">{resolution}</p>}
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Ekri yon repons…"
              aria-label="Ekri yon repons…"
              className="min-w-0 flex-1 rounded-full border-2 border-brand-soft bg-white px-3 py-2.5 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-soft focus:border-brand focus:shadow-brand-xs focus-visible:ring-2 focus-visible:ring-brand/30"
              onKeyDown={(e) => {
                if (e.key === "Enter" && reply.trim()) sendReply();
              }}
            />
            <label
              className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 border-brand-soft bg-white text-ink-soft hover:text-brand-deep"
              title={file ? file.name : "Tache yon pyès"}
            >
              <Paperclip className="h-4 w-4" />
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
            <Button
              size="icon-sm"
              className="shrink-0 hover:scale-110"
              disabled={send.isPending || uploading || !reply.trim()}
              onClick={sendReply}
              aria-label="Voye"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          {file && (
            <div className="flex items-center justify-between text-xs text-ink-soft">
              <span>Pyès tache: {file.name}</span>
              <button
                type="button"
                onClick={() => setFile(null)}
                className="font-bold text-brand-deep hover:underline"
              >
                Retire
              </button>
            </div>
          )}
          {canResolve && (
            <label className="flex items-center gap-2 text-xs font-bold text-ink-soft">
              <input
                type="checkbox"
                checked={internalNote}
                onChange={(e) => setInternalNote(e.target.checked)}
              />
              Nòt entèn (admin sèlman — lòt pati yo p ap wè li)
            </label>
          )}

          {canResolve && (
            <div className="rounded-xl border-2 border-dashed border-brand-soft p-3">
              <label
                htmlFor="dispute-resolution"
                className="mb-1 block text-xs font-bold uppercase text-ink-soft"
              >
                Rezolisyon final (admin)
              </label>
              <textarea
                id="dispute-resolution"
                value={resolutionText}
                onChange={(e) => setResolutionText(e.target.value)}
                rows={2}
                placeholder="Eksplike desizyon final la…"
                className={inputClsCompact()}
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
