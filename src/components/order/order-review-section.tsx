import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { StarPicker, StarRow } from "@/components/order/star-rating";
import { inputClsCompact } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

type OrderReviewSectionProps = {
  orderId: string;
  customerId: string | undefined;
  restaurantId: string;
  driverId: string | null | undefined;
};

/** Order-detail page's post-delivery review card: shows the existing review, or a restaurant/driver star form. */
export function OrderReviewSection({
  orderId,
  customerId,
  restaurantId,
  driverId,
}: OrderReviewSectionProps) {
  const qc = useQueryClient();

  const review = useQuery({
    queryKey: ["review", orderId, customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reviews")
        .select("*")
        .eq("order_id", orderId)
        .eq("customer_id", customerId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [restaurantRating, setRestaurantRating] = useState(0);
  const [driverRating, setDriverRating] = useState(0);
  const [reviewComment, setReviewComment] = useState("");

  const submitReview = useMutation({
    mutationFn: async () => {
      if (!restaurantRating) throw new Error("Bay yon nòt pou restoran an");
      const { error } = await supabase.from("reviews").insert({
        order_id: orderId,
        customer_id: customerId!,
        restaurant_id: restaurantId,
        driver_id: driverId ?? null,
        restaurant_rating: restaurantRating,
        driver_rating: driverId ? driverRating || null : null,
        comment: reviewComment || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Mèsi pou avi w!");
      qc.invalidateQueries({ queryKey: ["review", orderId] });
    },
    onError: (e) => toast.error(e.message ?? "Erè"),
  });

  return (
    <div className="rounded-2xl bg-white p-5 shadow-brand-xs ring-1 ring-brand-soft/40">
      <div className="font-display text-base font-bold">Bay avi w</div>
      {review.isLoading ? (
        <Skeleton className="mt-3 h-16 w-full rounded-xl" />
      ) : review.data ? (
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-ink-soft">Restoran:</span>
            <StarRow value={review.data.restaurant_rating ?? 0} />
          </div>
          {review.data.driver_rating != null && (
            <div className="flex items-center gap-2">
              <span className="text-ink-soft">Livrè:</span>
              <StarRow value={review.data.driver_rating} />
            </div>
          )}
          {review.data.comment && (
            <p className="rounded-xl bg-cream p-3 text-ink-soft">{review.data.comment}</p>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
              Nòt restoran
            </span>
            <StarPicker value={restaurantRating} onChange={setRestaurantRating} />
          </div>
          {driverId && (
            <div>
              <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
                Nòt livrè
              </span>
              <StarPicker value={driverRating} onChange={setDriverRating} />
            </div>
          )}
          <textarea
            value={reviewComment}
            onChange={(e) => setReviewComment(e.target.value)}
            placeholder="Kòmantè (opsyonèl)…"
            rows={3}
            className={inputClsCompact()}
          />
          <button
            disabled={submitReview.isPending}
            onClick={() => submitReview.mutate()}
            className="rounded-full bg-brand px-5 py-2.5 text-sm font-extrabold text-white shadow-brand-sm transition hover:-translate-y-0.5 hover:bg-brand-deep hover:shadow-brand-md disabled:pointer-events-none disabled:opacity-60"
          >
            {submitReview.isPending ? "Ap voye…" : "Voye avi"}
          </button>
        </div>
      )}
    </div>
  );
}
