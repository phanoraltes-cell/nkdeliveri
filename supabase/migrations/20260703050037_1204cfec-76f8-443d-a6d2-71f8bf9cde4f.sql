ALTER TABLE public.products ADD COLUMN IF NOT EXISTS dish_type text;
CREATE INDEX IF NOT EXISTS products_dish_type_idx ON public.products(dish_type);