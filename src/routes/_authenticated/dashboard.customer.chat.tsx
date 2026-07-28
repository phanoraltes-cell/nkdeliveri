import { createFileRoute } from "@tanstack/react-router";
import { ChatCenter } from "@/components/chat/chat-center";
import { useChatConversations } from "@/hooks/useChatConversations";

type ChatSearch = { order?: string };

export const Route = createFileRoute("/_authenticated/dashboard/customer/chat")({
  validateSearch: (search: Record<string, unknown>): ChatSearch => ({
    order: typeof search.order === "string" ? search.order : undefined,
  }),
  component: CustomerChatPage,
});

function CustomerChatPage() {
  const { order } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: conversations, isLoading } = useChatConversations();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-extrabold text-ink">Chat</h1>
        <p className="mt-1 text-sm text-ink-soft">Tout konvèsasyon w yo sou kòmand ou yo.</p>
      </div>
      <ChatCenter
        conversations={conversations ?? []}
        isLoading={isLoading}
        selectedOrderId={order ?? null}
        onSelectOrder={(id) => navigate({ search: { order: id ?? undefined } })}
      />
    </div>
  );
}
