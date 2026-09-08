import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, MessageCircle, Store, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { CHAT_OPEN_STATUSES } from "@/lib/order-status";
import { OrderChatThread } from "@/components/order/order-chat-thread";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import type { ChatConversationSummary } from "@/hooks/useChatConversations";

type ChatFilter = "all" | "unread" | "ongoing" | "completed";

const FILTERS: { key: ChatFilter; label: string }[] = [
  { key: "all", label: "Tout" },
  { key: "unread", label: "Non li" },
  { key: "ongoing", label: "An kou" },
  { key: "completed", label: "Fini" },
];

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "kounye a";
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}j`;
  return new Date(iso).toLocaleDateString("fr-HT");
}

function ConversationAvatar({ url }: { url: string | null }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        width={44}
        height={44}
        className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-brand-soft/40"
      />
    );
  }
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-soft/60 text-brand-deep">
      <Store className="h-5 w-5" aria-hidden="true" />
    </div>
  );
}

type ChatCenterProps = {
  conversations: ChatConversationSummary[];
  isLoading: boolean;
  selectedOrderId: string | null;
  onSelectOrder: (orderId: string | null) => void;
};

/**
 * Shared "Mwen > Chat" messaging center for client/driver/admin (restaurant
 * excluded — it never had chat access). One instance of this component is
 * mounted per role's own /dashboard/<role>/chat route; every row's RLS
 * scoping comes from useChatConversations itself, so nothing here needs to
 * know which role is viewing it.
 */
export function ChatCenter({
  conversations,
  isLoading,
  selectedOrderId,
  onSelectOrder,
}: ChatCenterProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ChatFilter>("all");

  const selected = conversations.find((c) => c.orderId === selectedOrderId) ?? null;

  // Covers opening a conversation that has no messages yet (the "Chat"
  // shortcuts on the order/delivery pages deep-link here even before a
  // first message exists) — useChatConversations only lists orders that
  // already have at least one order_chat_messages row, so this is the one
  // extra query needed to resolve a brand-new thread's header/isOpen state.
  const fallback = useQuery({
    queryKey: ["chat-order-fallback", selectedOrderId],
    enabled: !!selectedOrderId && !selected,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_number, status, restaurants(name, logo_url)")
        .eq("id", selectedOrderId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (filter === "unread" && !c.unread) return false;
      if (filter === "ongoing" && !c.isOpen) return false;
      if (filter === "completed" && c.isOpen) return false;
      if (!q) return true;
      return (
        c.orderNumber.toLowerCase().includes(q) ||
        (c.restaurantName?.toLowerCase().includes(q) ?? false) ||
        (c.driverName?.toLowerCase().includes(q) ?? false) ||
        (c.customerName?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [conversations, search, filter]);

  const headerOrderNumber = selected?.orderNumber ?? fallback.data?.order_number;
  const headerRestaurantName = selected?.restaurantName ?? fallback.data?.restaurants?.name ?? null;
  const headerLogoUrl = selected?.restaurantLogoUrl ?? fallback.data?.restaurants?.logo_url ?? null;
  const headerIsOpen = selected
    ? selected.isOpen
    : fallback.data
      ? CHAT_OPEN_STATUSES.has(fallback.data.status)
      : false;

  return (
    <div className="grid gap-4 md:h-[calc(100vh-200px)] md:min-h-[520px] md:grid-cols-[340px_1fr]">
      <div
        className={cn(
          "flex min-h-0 flex-col overflow-hidden rounded-2xl border border-brand-soft/60 bg-white shadow-sm",
          selectedOrderId && "hidden md:flex",
        )}
      >
        <div className="shrink-0 space-y-2 border-b border-brand-soft/40 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Chèche yon kòmand, restoran, non…"
              aria-label="Chèche nan chat yo"
              className="w-full rounded-full border-2 border-brand-soft bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-bold transition",
                  filter === f.key
                    ? "bg-brand text-white"
                    : "bg-brand-soft/50 text-ink hover:bg-brand-soft",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading && (
            <div className="space-y-2 p-3">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
            </div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="p-6">
              <EmptyState
                icon={MessageCircle}
                title="Pa gen konvèsasyon"
                description={
                  conversations.length === 0
                    ? "Konvèsasyon yo ap parèt isit la depi gen yon mesaj."
                    : "Pa gen konvèsasyon ki koresponn ak rechèch la."
                }
              />
            </div>
          )}
          <ul>
            {filtered.map((c) => {
              const isActive = c.orderId === selectedOrderId;
              const secondary = c.driverName
                ? `Livrè: ${c.driverName}`
                : c.customerName
                  ? `Kliyan: ${c.customerName}`
                  : (c.restaurantName ?? "");
              return (
                <li key={c.orderId}>
                  <button
                    type="button"
                    onClick={() => onSelectOrder(c.orderId)}
                    className={cn(
                      "flex w-full items-center gap-3 border-b border-brand-soft/20 px-3 py-3 text-left transition hover:bg-brand-soft/20",
                      isActive && "bg-brand-soft/40",
                    )}
                  >
                    <ConversationAvatar url={c.restaurantLogoUrl} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-display text-sm font-bold text-ink">
                          {c.orderNumber}
                        </span>
                        <span className="shrink-0 text-[11px] text-ink-soft">
                          {timeAgo(c.lastMessageAt)}
                        </span>
                      </div>
                      <div className="truncate text-xs text-ink-soft">{secondary}</div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <p
                          className={cn(
                            "truncate text-sm",
                            c.unread ? "font-bold text-ink" : "text-ink-soft",
                          )}
                        >
                          {c.lastMessagePreview}
                        </p>
                        {c.unread && (
                          <span
                            className="h-2 w-2 shrink-0 rounded-full bg-brand"
                            aria-label="Mesaj ki pa li"
                          />
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div
        className={cn(
          "flex min-h-0 flex-col overflow-hidden rounded-2xl border border-brand-soft/60 bg-white shadow-sm",
          !selectedOrderId && "hidden md:flex",
        )}
      >
        {selectedOrderId ? (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-brand-soft/40 p-3">
              <button
                type="button"
                onClick={() => onSelectOrder(null)}
                aria-label="Retounen nan lis la"
                className="rounded-full p-1.5 text-ink-soft hover:bg-brand-soft/40 hover:text-brand-deep md:hidden"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <ConversationAvatar url={headerLogoUrl} />
              <div className="min-w-0">
                <div className="truncate font-display text-sm font-bold text-ink">
                  {headerOrderNumber ?? "…"}
                </div>
                {headerRestaurantName && (
                  <div className="truncate text-xs text-ink-soft">{headerRestaurantName}</div>
                )}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <OrderChatThread orderId={selectedOrderId} isOpen={headerIsOpen} />
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState
              icon={MessageCircle}
              title="Chwazi yon konvèsasyon"
              description="Chwazi yon kòmand nan lis la pou wè mesaj yo."
            />
          </div>
        )}
      </div>
    </div>
  );
}
