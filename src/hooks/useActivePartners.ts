import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Tach 10 — patnè ofisyèl aktif yo, pataje ant footer.tsx (tout paj) ak
 * partners-section.tsx (paj akèy sèlman, apre seksyon scooter/enskripsyon
 * an, pou plis vizibilite reyèl — demand itilizatè). Yon sèl kote lojik
 * rechèch la ekri, pa de kopi ki ta ka dezakò. `.eq("is_active", true)`
 * eksplisit menm si RLS deja filtre pou anon/authenticated — konpòtman an
 * rete idantik kèlkeswa ki moun k ap gade (menm yon admin konekte).
 */
export function useActivePartners() {
  return useQuery({
    queryKey: ["active-partners"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partners")
        .select("id, name, logo_url, link_url")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}
