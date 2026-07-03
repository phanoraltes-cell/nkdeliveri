CREATE OR REPLACE FUNCTION public.create_order_secure(_restaurant_id uuid, _items jsonb, _delivery_address text, _contact_phone text, _delivery_notes text, _method payment_method)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT private.create_order_secure(_restaurant_id, _items, _delivery_address, _contact_phone, _delivery_notes, _method);
$function$;

REVOKE ALL ON FUNCTION public.create_order_secure(uuid, jsonb, text, text, text, payment_method) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order_secure(uuid, jsonb, text, text, text, payment_method) TO authenticated;