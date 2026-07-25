import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { sendDisputeUpdatePush } from "@/lib/send-dispute-push.functions";

/** The message thread (fetch + send) for a single dispute — shared by every dashboard that renders a DisputeThread. */
export function useDisputeMessages(disputeId: string | undefined) {
  const qc = useQueryClient();
  const sendPush = useServerFn(sendDisputeUpdatePush);

  const messages = useQuery({
    queryKey: ["dispute-messages", disputeId],
    enabled: !!disputeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dispute_messages")
        .select("id, author_id, author_role, message, created_at, is_internal, attachment_url")
        .eq("dispute_id", disputeId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const send = useMutation({
    mutationFn: async (
      input: string | { message: string; isInternal?: boolean; attachmentUrl?: string },
    ) => {
      const payload = typeof input === "string" ? { message: input } : input;
      const { error } = await supabase.rpc("add_dispute_message_secure", {
        _dispute_id: disputeId!,
        _message: payload.message,
        _is_internal: payload.isInternal ?? false,
        _attachment_url: payload.attachmentUrl,
      });
      if (error) throw error;
      try {
        await sendPush({ data: { disputeId: disputeId! } });
      } catch (e) {
        console.warn("push send failed", e);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dispute-messages", disputeId] });
    },
    onError: (e) => toast.error(e.message),
  });

  return { messages, send };
}
