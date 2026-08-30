-- PROMPT MODIFIKASYON (10 TACH) — Tach 10 (dènye a): seksyon "Patnè Ofisyèl
-- NK Deliveri" nan footer, jere pa admin, KACHE ANTYÈMAN si pa gen okenn
-- patnè aktif.
--
-- Nouvo tab `partners` — senp, endepandan de tout lòt sistèm (pa gen rapò
-- ak restoran/pwomosyon/piblisite). Lekti piblik dirèk (RLS, pa yon RPC)
-- paske se egzakteman menm nivo sansibilite ak `promotions`' "public
-- read" policy — done maketing ki pou tout moun wè, san okenn done
-- sansib ladan.
--
-- Wrapped BEGIN...COMMIT (A11 — Altes aplike fichye sa a manyèlman nan SQL
-- Editor Supabase, mwen (AI) pa janm egzekite l).
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Tab partners.
CREATE TABLE IF NOT EXISTS public.partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  logo_url text NOT NULL,
  link_url text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partners_active_sort ON public.partners(is_active, sort_order);

DROP TRIGGER IF EXISTS trg_partners_upd ON public.partners;
CREATE TRIGGER trg_partners_upd BEFORE UPDATE ON public.partners
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.partners TO anon, authenticated;
GRANT ALL ON public.partners TO service_role;
DROP POLICY IF EXISTS "partners_public_read" ON public.partners;
CREATE POLICY "partners_public_read" ON public.partners FOR SELECT
  USING (
    is_active = true
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );
-- Pa gen INSERT/UPDATE/DELETE dirèk — sèlman *_partner_secure pi ba.

-- ---------------------------------------------------------------------------
-- 2) Bucket partner-logos — piti (2MB, imaj sèlman), public read, admin
--    sèlman ekri (pa gen "owner" endividyèl posib, se admin ki jere tout
--    patnè yo, kontrèman ak restaurant-assets/menu-photos ki chemen pa
--    <restaurant_id>).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('partner-logos', 'partner-logos', true, 2 * 1024 * 1024,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "partner_logos_public_read" ON storage.objects;
CREATE POLICY "partner_logos_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'partner-logos');
DROP POLICY IF EXISTS "partner_logos_admin_write" ON storage.objects;
CREATE POLICY "partner_logos_admin_write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'partner-logos'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );
DROP POLICY IF EXISTS "partner_logos_admin_update" ON storage.objects;
CREATE POLICY "partner_logos_admin_update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'partner-logos'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );
DROP POLICY IF EXISTS "partner_logos_admin_delete" ON storage.objects;
CREATE POLICY "partner_logos_admin_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'partner-logos'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );

-- ---------------------------------------------------------------------------
-- 3) CRUD admin.
CREATE OR REPLACE FUNCTION public.list_partners_admin()
RETURNS SETOF public.partners
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.partners ORDER BY sort_order ASC, created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.list_partners_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_partners_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.create_partner_secure(
  _name text, _logo_url text, _link_url text DEFAULT NULL, _sort_order int DEFAULT 0
)
RETURNS public.partners
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.partners;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _name IS NULL OR length(btrim(_name)) = 0 THEN
    RAISE EXCEPTION 'Non patnè a obligatwa.';
  END IF;
  IF _logo_url IS NULL OR length(btrim(_logo_url)) = 0 THEN
    RAISE EXCEPTION 'Logo a obligatwa.';
  END IF;
  INSERT INTO public.partners (name, logo_url, link_url, sort_order, created_by)
  VALUES (btrim(_name), _logo_url, NULLIF(btrim(_link_url), ''), _sort_order, auth.uid())
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.create_partner_secure(text, text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_partner_secure(text, text, text, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_partner_secure(
  _id uuid, _name text, _logo_url text, _link_url text, _sort_order int, _is_active boolean
)
RETURNS public.partners
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.partners;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _name IS NULL OR length(btrim(_name)) = 0 THEN
    RAISE EXCEPTION 'Non patnè a obligatwa.';
  END IF;
  IF _logo_url IS NULL OR length(btrim(_logo_url)) = 0 THEN
    RAISE EXCEPTION 'Logo a obligatwa.';
  END IF;
  UPDATE public.partners SET
    name = btrim(_name), logo_url = _logo_url, link_url = NULLIF(btrim(_link_url), ''),
    sort_order = _sort_order, is_active = _is_active
  WHERE id = _id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Patnè pa jwenn'; END IF;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.update_partner_secure(uuid, text, text, text, int, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_partner_secure(uuid, text, text, text, int, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_partner_secure(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.partners WHERE id = _id;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_partner_secure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_partner_secure(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Règ A11 — INSERT nan menm skript la, dènye deklarasyon anvan COMMIT.
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260830110000', 'footer_partners')
ON CONFLICT (version) DO NOTHING;

COMMIT;
