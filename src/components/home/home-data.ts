import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Yon pàn isit la pa kraze paj la — li BAY YON DAKÈY VID. Se egzakteman sa
 * ki fè li danjere: san yon siyal, yon pàn Supabase ki dire ta sèvi yon
 * dakèy san restoran, an 200, pou tout tan, epi Google ta reendekse l konsa.
 *
 * `console.error` pou kont li pa t ase: sou Vercel li ale nan log fonksyon
 * yo, kote pèsonn pa li yo.
 *
 * De pwi paske fonksyon sa a kouri toude bò: nan chajè a pandan SSR (se la
 * ka ki pi grav la ye — se Googlebot ki wè rezilta a) epi nan navigatè a
 * lè react-query refè demann lan. `money.ts` gen menm pwen avèg la epi li
 * chwazi kliyan an sèlman; isit la nou pa ka, paske se bò sèvè a ki konte.
 */
function reportHomeDataFailure(what: "restaurants" | "products", cause: unknown): void {
  const error = new Error(`[home-data] ${what} failed to load`, { cause });
  console.error(error);

  // Sentry pa obligatwa pou paj la mache — konsòl la deja gen tras la.
  const sink =
    typeof window === "undefined"
      ? import("@/lib/sentry.server").then((m) => m.captureExceptionServer(error))
      : import("@/lib/sentry-browser").then((m) => m.captureExceptionClient(error));
  void sink.catch(() => {});
}

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
  if (rests.error) reportHomeDataFailure("restaurants", rests.error);
  if (prods.error) reportHomeDataFailure("products", prods.error);
  return { restaurants: rests.data ?? [], products: prods.data ?? [] };
}

export const homeDataQuery = queryOptions({
  queryKey: ["home-data"],
  queryFn: fetchHomeData,
});

export type HomeRestaurant = Awaited<ReturnType<typeof fetchHomeData>>["restaurants"][number];
export type HomeProduct = Awaited<ReturnType<typeof fetchHomeData>>["products"][number];
