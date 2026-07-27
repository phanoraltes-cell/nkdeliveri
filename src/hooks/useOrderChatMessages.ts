import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type SendChatMessageInput = {
  message?: string;
  imageUrl?: string;
  lat?: number;
  lng?: number;
};

/**
 * Order-scoped chat thread (customer/driver/admin — never the restaurant).
 * Unlike useDisputeMessages.ts, this has a real Realtime subscription from
 * the start (order_chat_messages is already in the publication) instead of
 * relying on invalidate-on-send-only.
 */
export function useOrderChatMessages(orderId: string | undefined) {
  const qc = useQueryClient();
  const queryKey = ["order-chat-messages", orderId] as const;

  const messages = useQuery({
    queryKey,
    enabled: !!orderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_chat_messages")
        .select("id, author_id, author_role, message, image_url, lat, lng, created_at")
        .eq("order_id", orderId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!orderId) return;
    const channel = supabase
      .channel(`order-chat-${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "order_chat_messages",
          filter: `order_id=eq.${orderId}`,
        },
        () => qc.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const send = useMutation({
    mutationFn: async (input: SendChatMessageInput) => {
      const { error } = await supabase.rpc("send_order_chat_message_secure", {
        _order_id: orderId!,
        _message: input.message,
        _image_url: input.imageUrl,
        _lat: input.lat,
        _lng: input.lng,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (e) => toast.error(e.message),
  });

  const markRead = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("mark_order_chat_read_secure", { _order_id: orderId! });
      if (error) throw error;
    },
  });

  return { messages, send, markRead };
}
