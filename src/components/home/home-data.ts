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
  // DEGRADE, PA KRAZE — se kòz rasin tit « Yon erè rive » ki te endekse a.
  //
  // Anvan, chak `error` isit la te LANSE. Loader dakèy la ap tann fonksyon
  // sa a, donk yon sèl ti pàn Supabase (timeout, kota, rezo) te fè wout la
  // echwe nèt, ErrorBoundary la te rann, epi Googlebot — ki egzekite
  // JavaScript — te endekse tit paj erè a kòm tit dakèy la.
  //
  // Dakèy la se paj ki pi enpòtan an pou rechèch. Li dwe rann menm ak yon
  // seksyon vid. Nou anrejistre erè a pou yon pàn ki dire pa disparèt an
  // silans, men nou pa kite l tonbe tout paj la.
  if (rests.error) console.error("[home-data] restaurants failed to load", rests.error);
  if (prods.error) console.error("[home-data] products failed to load", prods.error);
  return { restaurants: rests.data ?? [], products: prods.data ?? [] };
}

export const homeDataQuery = queryOptions({
  queryKey: ["home-data"],
  queryFn: fetchHomeData,
});

export type HomeRestaurant = Awaited<ReturnType<typeof fetchHomeData>>["restaurants"][number];
export type HomeProduct = Awaited<ReturnType<typeof fetchHomeData>>["products"][number];
