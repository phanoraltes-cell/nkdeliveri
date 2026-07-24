-- Security fix: public.get_restaurant_payout_public(_restaurant_id) leaked
-- any restaurant's MonCash/NatCash phone number + account name to ANY
-- authenticated user (not just the owner/admin) -- it had no access
-- control inside its body at all beyond matching the id, and was
-- GRANT-ed to `authenticated`. Confirmed unused by the current frontend
-- (zero callers in src/), but reachable directly via the Supabase RPC
-- endpoint by any logged-in user regardless of role. Root-caused and
-- reported in this session's RLS audit; this migration is the fix.
--
-- Correction to the original diagnosis: the first version of this
-- migration assumed the 6-column shape from 20260703200500.sql (with a
-- `payout_mode` column and a `restaurants` status join). Applying it
-- against the real linked database failed with "cannot change return
-- type of existing function" -- 20260718160000_restaurant_payout_always_
-- via_admin.sql (never read during the original audit) had already
-- dropped `payout_mode` and the status/join logic entirely, replacing the
-- live function with an even simpler, still-unrestricted 5-column
-- version. This rewrite matches that real, currently-deployed shape --
-- verified directly against `supabase migration list --linked` and the
-- exact failing CREATE OR REPLACE, not assumed from an intermediate file.
--
-- New rule: only the restaurant owner or an admin/super_admin (same
-- private.is_restaurant_manager() helper already used everywhere else in
-- the financial module for this exact "can manage this restaurant's
-- business data" check) ever receives the real moncash_number/
-- moncash_account_name/natcash_number/natcash_account_name. Every other
-- authenticated caller receives NULL for those 4 columns -- never a
-- masked partial value, since this RPC has no established legitimate
-- product use case for a stranger to see even part of another business's
-- payout number. `restaurant_id` itself stays visible to any caller who
-- can already resolve the row (unchanged from the live behavior -- this
-- fix does not add or remove any row-visibility gate that wasn't already
-- there, it only masks the 4 sensitive columns).
--
-- Same signature and 5-column return shape as the real live function --
-- CREATE OR REPLACE in place, no DROP FUNCTION needed.
CREATE OR REPLACE FUNCTION public.get_restaurant_payout_public(_restaurant_id uuid)
RETURNS TABLE (
  restaurant_id uuid,
  moncash_number text,
  moncash_account_name text,
  natcash_number text,
  natcash_account_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_authorized boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- Cas 1 (propriétaire) + Cas 2 (admin/super_admin) : couverts tels quels
  -- par le helper déjà utilisé partout ailleurs dans le module financier.
  v_authorized := private.is_restaurant_manager(_restaurant_id);

  -- Cas 3 (employés autorisés) : aucun restaurant_staff n'est aujourd'hui
  -- habilité à voir les numéros de paiement -- cohérent avec
  -- is_restaurant_manager()/payout_beneficiary_visible(), qui excluent
  -- déjà volontairement restaurant_staff partout ailleurs dans ce module
  -- (accès financier réservé au propriétaire, pas à l'équipe
  -- opérationnelle). Point d'extension explicite si un futur besoin
  -- produit l'exige, par ex. :
  --   OR EXISTS (
  --     SELECT 1 FROM public.restaurant_employees e
  --     WHERE e.restaurant_id = _restaurant_id AND e.user_id = auth.uid()
  --       AND e.can_view_payout_info = true  -- colonne à créer si ce cas devient réel
  --   )

  RETURN QUERY
  SELECT
    d.restaurant_id,
    CASE WHEN v_authorized THEN d.moncash_number ELSE NULL END,
    CASE WHEN v_authorized THEN d.moncash_account_name ELSE NULL END,
    CASE WHEN v_authorized THEN d.natcash_number ELSE NULL END,
    CASE WHEN v_authorized THEN d.natcash_account_name ELSE NULL END
  FROM public.restaurant_payout_details d
  WHERE d.restaurant_id = _restaurant_id;
END;
$$;

-- Least privilege explicite : jamais anon (aucun besoin identifié,
-- contrairement à get_platform_payout_public qui sert le checkout avant
-- connexion), jamais PUBLIC.
REVOKE ALL ON FUNCTION public.get_restaurant_payout_public(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_restaurant_payout_public(uuid) TO authenticated;

-- Hygiène/durcissement : private.get_restaurant_payout_public(uuid) est un
-- résidu de 20260703080029, plus jamais appelé nulle part, et déjà
-- REVOKE ALL FROM PUBLIC, anon, authenticated donc jamais atteignable
-- directement par un client. Sa propre définition ne filtre STRICTEMENT
-- RIEN (aucune clause WHERE de visibilité) -- elle ne représente un risque
-- que si un futur GRANT malencontreux la rendait à nouveau exécutable.
-- Supprimée pour fermer définitivement cette surface latente plutôt que de
-- compter sur le seul REVOKE pour la neutraliser indéfiniment.
DROP FUNCTION IF EXISTS private.get_restaurant_payout_public(uuid);
