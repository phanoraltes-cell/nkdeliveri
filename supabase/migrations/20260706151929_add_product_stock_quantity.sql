-- Simple per-dish stock count (no variants — see conversation decision).
-- NULL means "unlimited / not tracked", matching how `available` already
-- defaults to true: restaurants that don't care about stock see no change.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock_quantity integer;

ALTER TABLE public.products
  ADD CONSTRAINT products_stock_quantity_non_negative
  CHECK (stock_quantity IS NULL OR stock_quantity >= 0);

CREATE OR REPLACE FUNCTION public.create_product_secure(
  _restaurant_id uuid, _category_id uuid, _name text, _description text,
  _price numeric, _image_url text, _dish_type text, _stock_quantity integer DEFAULT NULL
)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.products;
BEGIN
  IF NOT private.is_restaurant_manager(_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _name IS NULL OR length(btrim(_name)) = 0 THEN
    RAISE EXCEPTION 'Dish name is required';
  END IF;
  IF _price IS NULL OR _price < 0 THEN
    RAISE EXCEPTION 'Price must be zero or more';
  END IF;
  IF _stock_quantity IS NOT NULL AND _stock_quantity < 0 THEN
    RAISE EXCEPTION 'Stock quantity must be zero or more';
  END IF;
  IF _category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.menu_categories WHERE id = _category_id AND restaurant_id = _restaurant_id
  ) THEN
    RAISE EXCEPTION 'Category does not belong to this restaurant';
  END IF;
  INSERT INTO public.products (restaurant_id, category_id, name, description, price, image_url, dish_type, stock_quantity)
  VALUES (_restaurant_id, _category_id, btrim(_name), _description, _price, _image_url, _dish_type, _stock_quantity)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_product_secure(
  _product_id uuid, _name text, _description text, _price numeric,
  _image_url text, _dish_type text, _category_id uuid, _available boolean,
  _stock_quantity integer DEFAULT NULL
)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.products;
BEGIN
  SELECT * INTO v_row FROM public.products WHERE id = _product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dish not found'; END IF;
  IF NOT private.is_restaurant_manager(v_row.restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _name IS NULL OR length(btrim(_name)) = 0 THEN
    RAISE EXCEPTION 'Dish name is required';
  END IF;
  IF _price IS NULL OR _price < 0 THEN
    RAISE EXCEPTION 'Price must be zero or more';
  END IF;
  IF _stock_quantity IS NOT NULL AND _stock_quantity < 0 THEN
    RAISE EXCEPTION 'Stock quantity must be zero or more';
  END IF;
  IF _category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.menu_categories WHERE id = _category_id AND restaurant_id = v_row.restaurant_id
  ) THEN
    RAISE EXCEPTION 'Category does not belong to this restaurant';
  END IF;
  UPDATE public.products SET
    name = btrim(_name), description = _description, price = _price, image_url = _image_url,
    dish_type = _dish_type, category_id = _category_id, available = _available,
    stock_quantity = _stock_quantity, updated_at = now()
  WHERE id = _product_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
