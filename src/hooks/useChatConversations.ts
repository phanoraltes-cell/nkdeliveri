import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { CHAT_OPEN_STATUSES } from "@/lib/order-status";

export type ChatConversationSummary = {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  restaurantName: string | null;
  restaurantLogoUrl: string | null;
  driverName: string | null;
  customerName: string | null;
  lastAuthorRole: string;
  lastMessagePreview: string;
  lastMessageAt: string;
  isOpen: boolean;
  unread: boolean;
};

// order_chat_messages carries no header row (unlike disputes) — the
// conversation list is derived straight from the messages themselves,
// RLS-scoped identically to the existing per-order thread (see
// private.order_chat_author_role), so this one query already returns
// exactly what each of the 3 roles is allowed to see, with no per-role
// branching needed here.
const CONVERSATIONS_SELECT =
  "order_id, message, image_url, lat, author_role, created_at, orders(order_number, status, customer_id, restaurants(name, logo_url), deliveries(drivers(first_name, last_name)))";

function previewFor(row: { message: string | null; image_url: string | null; lat: number | null }) {
  if (row.message) return row.message;
  if (row.image_url) return "📷 Foto";
  if (row.lat != null) return "📍 Pozisyon";
  return "…";
}

async function fetchConversations(userId: string): Promise<ChatConversationSummary[]> {
  const [{ data: rows, error }, { data: reads, error: readsErr }] = await Promise.all([
    supabase
      .from("order_chat_messages")
      .select(CONVERSATIONS_SELECT)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase.from("order_chat_reads").select("order_id, last_read_at").eq("user_id", userId),
  ]);
  if (error) throw error;
  if (readsErr) throw readsErr;

  const lastReadByOrder = new Map((reads ?? []).map((r) => [r.order_id, r.last_read_at]));

  // Rows are already sorted newest-first, so the first row seen per
  // order_id is that conversation's latest message.
  const latestByOrder = new Map<string, (typeof rows)[number]>();
  for (const row of rows ?? []) {
    if (!latestByOrder.has(row.order_id)) latestByOrder.set(row.order_id, row);
  }

  // Customer name has no direct FK from orders (see profiles table) —
  // resolved with one small batched lookup instead of a per-row query.
  const customerIds = Array.from(
    new Set(
      Array.from(latestByOrder.values(), (r) => r.orders?.customer_id).filter(
        (v): v is string => !!v,
      ),
    ),
  );
  const profilesById = new Map<string, { first_name: string | null; last_name: string | null }>();
  if (customerIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", customerIds);
    for (const p of profiles ?? []) profilesById.set(p.id, p);
  }

  return Array.from(latestByOrder.values())
    .map((row): ChatConversationSummary | null => {
      const order = row.orders;
      if (!order) return null;
      const driver = order.deliveries?.drivers;
      const customer = order.customer_id ? profilesById.get(order.customer_id) : undefined;
      const lastReadAt = lastReadByOrder.get(row.order_id);
      return {
        orderId: row.order_id,
        orderNumber: order.order_number,
        orderStatus: order.status,
        restaurantName: order.restaurants?.name ?? null,
        restaurantLogoUrl: order.restaurants?.logo_url ?? null,
        driverName: driver
          ? `${driver.first_name ?? ""} ${driver.last_name ?? ""}`.trim() || null
          : null,
        customerName: customer
          ? `${customer.first_name ?? ""} ${customer.last_name ?? ""}`.trim() || null
          : null,
        lastAuthorRole: row.author_role,
        lastMessagePreview: previewFor(row),
        lastMessageAt: row.created_at,
        isOpen: CHAT_OPEN_STATUSES.has(order.status),
        unread: !lastReadAt || new Date(row.created_at) > new Date(lastReadAt),
      };
    })
    .filter((c): c is ChatConversationSummary => c != null)
    .sort((a, b) => +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt));
}

/**
 * "Mwen > Chat" conversation list — every order the caller has an existing
 * chat thread on (customer/driver/admin, RLS-scoped, never restaurant).
 * One realtime channel for the whole list (not one per conversation); the
 * open thread itself still uses useOrderChatMessages' own per-order
 * channel unchanged, so a session viewing the center never runs more than
 * two chat subscriptions at once regardless of how many conversations exist.
 */
export function useChatConversations() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const queryKey = ["chat-conversations", user?.id] as const;

  const query = useQuery({
    queryKey,
    enabled: !!user,
    queryFn: () => fetchConversations(user!.id),
  });

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`chat-conversations-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "order_chat_messages" },
        () => qc.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return query;
}
