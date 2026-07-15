import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

async function fetchHomeData() {
  const [rests, prods] = await Promise.all([
    supabase
      .from("restaurants")
      .select("id,slug,name,cuisine,logo_url,cover_url,rating,avg_prep_time,delivery_fee")
      .eq("status", "approved")
      .order("rating", { ascending: false })
      .limit(8),
    supabase
      .from("products")
      .select(
        "id,name,description,price,image_url,dish_type,restaurant_id,restaurants!inner(name,slug,status)",
      )
      .eq("available", true)
      .eq("restaurants.status", "approved")
      .order("created_at", { ascending: false })
      .limit(16),
  ]);
  if (rests.error) throw rests.error;
  if (prods.error) throw prods.error;
  return { restaurants: rests.data ?? [], products: prods.data ?? [] };
}

export const homeDataQuery = queryOptions({
  queryKey: ["home-data"],
  queryFn: fetchHomeData,
});

export type HomeRestaurant = Awaited<ReturnType<typeof fetchHomeData>>["restaurants"][number];
export type HomeProduct = Awaited<ReturnType<typeof fetchHomeData>>["products"][number];
