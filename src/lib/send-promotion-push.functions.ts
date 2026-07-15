import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({ promotionId: z.string().uuid() });

/** Called right after create_promotion_secure succeeds — notifies customers who favorited the restaurant. */
export const sendNewPromotionPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: promotion, error } = await supabaseAdmin
      .from("promotions")
      .select("id, title, restaurant_id, restaurants(name)")
      .eq("id", data.promotionId)
      .single();
    if (error || !promotion) throw new Error(error?.message || "Promotion not found");

    const { data: favorites, error: favErr } = await supabaseAdmin
      .from("favorites")
      .select("user_id")
      .eq("restaurant_id", promotion.restaurant_id);
    if (favErr) throw new Error(favErr.message);
    if (!favorites || favorites.length === 0) return { sent: 0 };

    const restaurantName = promotion.restaurants?.name ?? "Yon restoran ou renmen";

    const { pushToUsers } = await import("@/lib/push-dispatch.server");
    return pushToUsers(
      favorites.map((f) => f.user_id),
      {
        title: "Nouvo pwomosyon 🎉",
        body: `${restaurantName} gen yon nouvo pwomosyon: ${promotion.title}.`,
        url: `/restaurants`,
        tag: `promotion-${promotion.id}`,
        data: { restaurantId: promotion.restaurant_id, promotionId: promotion.id },
      },
    );
  });
