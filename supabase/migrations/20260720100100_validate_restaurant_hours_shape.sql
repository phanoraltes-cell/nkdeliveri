-- update_restaurant_hours_secure previously accepted any jsonb value with
-- zero shape validation. The React form always sends a well-formed
-- Record<dayKey, {open, close, closed}>, but the RPC itself is
-- GRANT EXECUTE'd to `authenticated` and reachable directly via Supabase's
-- RPC endpoint (not just through this form) — private.is_restaurant_manager
-- already gates WHICH restaurant a caller can touch, but nothing gated WHAT
-- shape they could write. Malformed opening_hours would then break every
-- reader that assumes the shape (this form's own re-hydration, and the
-- public restaurant page rendering hours to customers).
CREATE OR REPLACE FUNCTION public.update_restaurant_hours_secure(_restaurant_id uuid, _opening_hours jsonb)
RETURNS public.restaurants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.restaurants;
  v_key text;
  v_value jsonb;
BEGIN
  IF NOT private.is_restaurant_manager(_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(_opening_hours) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'opening_hours dwe yon objè JSON' USING ERRCODE = '22023';
  END IF;

  FOR v_key, v_value IN SELECT * FROM jsonb_each(_opening_hours) LOOP
    IF v_key NOT IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun') THEN
      RAISE EXCEPTION 'Jou envalid nan opening_hours: %', v_key USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_value) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Chak jou dwe gen yon objè {open, close, closed}' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_value->'closed') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION '"closed" dwe yon bolean pou %', v_key USING ERRCODE = '22023';
    END IF;
    IF (v_value->>'closed')::boolean IS FALSE THEN
      IF v_value->>'open' IS NULL OR v_value->>'open' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
        RAISE EXCEPTION '"open" envalid pou %', v_key USING ERRCODE = '22023';
      END IF;
      IF v_value->>'close' IS NULL OR v_value->>'close' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
        RAISE EXCEPTION '"close" envalid pou %', v_key USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;

  UPDATE public.restaurants SET opening_hours = _opening_hours
  WHERE id = _restaurant_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
