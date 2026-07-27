import { useEffect, useRef, useState } from "react";
import { Send, Paperclip, MapPin, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { assertValidUploadFile } from "@/lib/file-validation";
import { useOrderChatMessages } from "@/hooks/useOrderChatMessages";
import { useHiddenHistory } from "@/hooks/useHiddenHistory";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { ProofThumb } from "@/components/proof-thumb";

const AUTHOR_ROLE_LABEL: Record<string, string> = {
  customer: "Kliyan",
  driver: "Livrè",
  admin: "Admin",
};

const TYPING_BROADCAST_THROTTLE_MS = 2500;
const TYPING_INDICATOR_TIMEOUT_MS = 3500;

type OrderChatThreadProps = {
  orderId: string;
  /** Chat is server-side enforced read-only outside these statuses too — this only controls the compose UI. */
  isOpen: boolean;
};

/** Order-scoped chat (customer/driver/admin — never the restaurant), fork of DisputeThread without the resolution form. */
export function OrderChatThread({ orderId, isOpen }: OrderChatThreadProps) {
  const { user } = useAuth();
  const { messages, send, markRead } = useOrderChatMessages(orderId);
  const { hiddenIds, hide } = useHiddenHistory("chat");
  const { requestConfirm, ConfirmDialog } = useConfirmDialog();
  const [reply, setReply] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const lastTypingBroadcastRef = useRef(0);

  // Marks the thread read once messages have loaded and whenever a new one
  // arrives while the thread is mounted (i.e. actually being looked at).
  useEffect(() => {
    if (messages.data && messages.data.length > 0) markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.data?.length]);

  useEffect(() => {
    const channel = supabase.channel(`order-chat-typing-${orderId}`);
    channel
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (payload?.userId === user?.id) return;
        setPeerTyping(true);
        if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = window.setTimeout(
          () => setPeerTyping(false),
          TYPING_INDICATOR_TIMEOUT_MS,
        );
      })
      .subscribe();
    typingChannelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  function notifyTyping() {
    const now = Date.now();
    if (now - lastTypingBroadcastRef.current < TYPING_BROADCAST_THROTTLE_MS) return;
    lastTypingBroadcastRef.current = now;
    typingChannelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { userId: user?.id },
    });
  }

  async function sendReply() {
    const text = reply.trim();
    if (!text && !file) return;
    let imageUrl: string | undefined;
    if (file) {
      try {
        setUploading(true);
        assertValidUploadFile(file, "order-chat-attachments");
        const path = `${orderId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
        const { error } = await supabase.storage
          .from("order-chat-attachments")
          .upload(path, file, { upsert: false });
        if (error) throw error;
        imageUrl = path;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Echèk voye foto a");
        setUploading(false);
        return;
      }
      setUploading(false);
    }
    send.mutate({ message: text || undefined, imageUrl });
    setReply("");
    setFile(null);
  }

  function sendLocationPin() {
    if (!navigator.geolocation) {
      toast.error("GPS pa disponib nan navigatè sa a");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => send.mutate({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => toast.error("Nou pa t kapab jwenn pozisyon w"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function hideConversation() {
    requestConfirm(
      "Kache konvèsasyon sa a nan vi pèsonèl ou? Sa a pa efase mesaj yo pou lòt moun, e sa ka irevèsib pou vi pa w.",
      () => hide.mutate([orderId], { onSuccess: () => toast.success("Konvèsasyon kache") }),
    );
  }

  if (hiddenIds.has(orderId)) {
    return (
      <div className="mt-3 rounded-xl bg-ink/5 p-3 text-center text-xs text-ink-soft">
        Ou kache konvèsasyon sa a.
        {ConfirmDialog}
      </div>
    );
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
        {messages.data?.length === 0 && (
          <p className="py-4 text-center text-xs text-ink-soft">Poko gen mesaj.</p>
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
            {m.message && <p className="text-ink">{m.message}</p>}
            {m.image_url && (
              <div className="mt-1.5">
                <ProofThumb path={m.image_url} bucket="order-chat-attachments" alt="Foto" />
              </div>
            )}
            {m.lat != null && m.lng != null && (
              <a
                href={`https://www.google.com/maps?q=${m.lat},${m.lng}`}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-brand-deep hover:underline"
              >
                <MapPin className="h-3 w-3" /> Wè pozisyon sou kat
              </a>
            )}
          </div>
        ))}
        {peerTyping && <p className="text-xs italic text-ink-soft">Ap ekri…</p>}
      </div>

      {isOpen ? (
        <div className="flex gap-2">
          <input
            value={reply}
            onChange={(e) => {
              setReply(e.target.value);
              notifyTyping();
            }}
            placeholder="Ekri yon mesaj…"
            aria-label="Ekri yon mesaj…"
            className="min-w-0 flex-1 rounded-full border-2 border-brand-soft bg-white px-3 py-2.5 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-soft focus:border-brand focus:shadow-brand-xs focus-visible:ring-2 focus-visible:ring-brand/30"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (reply.trim() || file)) sendReply();
            }}
          />
          <label
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 border-brand-soft bg-white text-ink-soft hover:text-brand-deep"
            title={file ? file.name : "Tache yon foto"}
          >
            <Paperclip className="h-4 w-4" />
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          <button
            type="button"
            onClick={sendLocationPin}
            title="Voye pozisyon aktyèl ou"
            aria-label="Voye pozisyon aktyèl ou"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-brand-soft bg-white text-ink-soft hover:text-brand-deep"
          >
            <MapPin className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={send.isPending || uploading || (!reply.trim() && !file)}
            onClick={sendReply}
            aria-label="Voye"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-brand-sm transition hover:-translate-y-0.5 hover:bg-brand-deep hover:shadow-brand-md disabled:pointer-events-none disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="rounded-xl bg-ink/5 p-3 text-center text-xs text-ink-soft">
          <p>Chat la fèmen — li rete disponib kòm istorik.</p>
          <button
            type="button"
            onClick={hideConversation}
            className="mt-2 inline-flex items-center gap-1 font-bold text-brand-deep hover:underline"
          >
            <EyeOff className="h-3 w-3" /> Kache konvèsasyon an
          </button>
        </div>
      )}
      {file && (
        <div className="flex items-center justify-between text-xs text-ink-soft">
          <span>Foto tache: {file.name}</span>
          <button
            type="button"
            onClick={() => setFile(null)}
            className="font-bold text-brand-deep hover:underline"
          >
            Retire
          </button>
        </div>
      )}
      {ConfirmDialog}
    </div>
  );
}
