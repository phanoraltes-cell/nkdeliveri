-- Remediation of docs/archive/audits/DRIVER_RESTAURANT_REGISTRATION_AUDIT.md § 9/13 (Root
-- Cause R2): update_driver_status_secure had no check at all before
-- allowing a transition to 'approved' -- confirmed live via the only real
-- driver in production (id_doc_url IS NULL, status = 'online'). Per the
-- remediation mission's own Phase 5, this must be a BACKEND authority, not
-- just a frontend affordance -- a direct RPC call must be blocked exactly
-- like a UI click.
--
-- Phase 4's own question ("une simple valeur textuelle ne doit pas
-- forcément être considérée comme preuve suffisante") is answered here by
-- checking two things, not one: (1) id_doc_url is a non-empty string, AND
-- (2) a matching object genuinely exists in storage.objects for the
-- 'driver-documents' bucket -- this SECURITY DEFINER function already has
-- implicit access to the storage schema regardless of PostgREST's exposed-
-- schema config (same reasoning used by stamp_storage_object_owner_secure
-- in the sibling migration), so this is a real existence check, not just a
-- column-is-not-null check.
--
-- Signature unchanged (uuid, driver_status, text) -- safe in-place
-- CREATE OR REPLACE, existing GRANTs untouched. Body otherwise identical to
-- the currently-live version (20260722170000_drivers_admin.sql).
CREATE OR REPLACE FUNCTION public.update_driver_status_secure(
  _driver_id uuid, _status public.driver_status, _reason text DEFAULT NULL
)
RETURNS public.drivers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.drivers;
  v_id_doc_url text;
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF _status = 'approved' THEN
    SELECT id_doc_url INTO v_id_doc_url FROM public.drivers WHERE id = _driver_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Driver not found';
    END IF;

    IF v_id_doc_url IS NULL OR btrim(v_id_doc_url) = '' THEN
      RAISE EXCEPTION 'Pa ka apwouve: pyès idantite obligatwa a poko mete nan dosye a.' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM storage.objects
      WHERE bucket_id = 'driver-documents' AND name = v_id_doc_url
    ) THEN
      RAISE EXCEPTION 'Pa ka apwouve: fichye pyès idantite a pa jwenn nan depo a. Mande livrè a chaje l ankò.' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.drivers SET status = _status, updated_at = now()
  WHERE id = _driver_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Driver not found';
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_row.user_id, 'driver_status_changed',
    CASE _status
      WHEN 'approved' THEN 'Kont ou apwouve'
      WHEN 'suspended' THEN 'Kont ou sispann'
      WHEN 'rejected' THEN 'Kont ou rejte'
      ELSE 'Estati kont ou chanje'
    END,
    COALESCE(NULLIF(btrim(_reason), ''), 'Yon administratè chanje estati kont ou.'),
    jsonb_build_object('status', _status)
  );

  PERFORM private.log_audit_event(auth.uid(), 'admin', 'driver.status_changed',
    jsonb_build_object('driver_id', _driver_id, 'status', _status, 'reason', _reason));

  RETURN v_row;
END;
$$;
