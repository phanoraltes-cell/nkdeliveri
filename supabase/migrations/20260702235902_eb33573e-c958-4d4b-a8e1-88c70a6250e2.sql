
-- Update product images with real Haitian dish photos (CDN paths served same-origin)
UPDATE public.products SET image_url = '/__l5e/assets-v1/c5c7995b-950c-4638-a59f-e514caf93841/diri-kole.webp'   WHERE name = 'Diri ak Pwa Kolé';
UPDATE public.products SET image_url = '/__l5e/assets-v1/880fc94c-d7da-4e01-b5f1-a42cd5c0042d/multi-plat.webp' WHERE name = 'Poul nan Sòs';
UPDATE public.products SET image_url = '/__l5e/assets-v1/21555bbd-8e8f-4e13-b88e-2e30aba50089/fritay.webp'    WHERE name IN ('Griyo ak Banann','Tasso Kabrit');
UPDATE public.products SET image_url = '/__l5e/assets-v1/752694ab-b455-46f1-95c9-55c84da9fb62/lalo.webp'      WHERE name = 'Lambi nan Sòs';
UPDATE public.products SET image_url = '/__l5e/assets-v1/0e046822-8014-435f-93a6-9ece6364658e/diri-sospwa.webp' WHERE name = 'Pwason Gwo Sèl';

-- Restaurant covers
UPDATE public.restaurants SET cover_url = '/__l5e/assets-v1/c5c7995b-950c-4638-a59f-e514caf93841/diri-kole.webp' WHERE slug = 'chez-marie';
UPDATE public.restaurants SET cover_url = '/__l5e/assets-v1/21555bbd-8e8f-4e13-b88e-2e30aba50089/fritay.webp'   WHERE slug = 'griyo-express';
UPDATE public.restaurants SET cover_url = '/__l5e/assets-v1/752694ab-b455-46f1-95c9-55c84da9fb62/lalo.webp'     WHERE slug = 'ocean-fresh';
UPDATE public.restaurants SET cover_url = '/__l5e/assets-v1/880fc94c-d7da-4e01-b5f1-a42cd5c0042d/multi-plat.webp' WHERE slug = 'ti-boutik-manje';

-- Add new authentic Haitian dishes to Chez Marie (Kreyòl restaurant)
DO $$
DECLARE
  rid uuid;
  cat_plat uuid;
BEGIN
  SELECT id INTO rid FROM public.restaurants WHERE slug = 'chez-marie';
  IF rid IS NOT NULL THEN
    SELECT id INTO cat_plat FROM public.menu_categories WHERE restaurant_id = rid ORDER BY sort_order LIMIT 1;

    INSERT INTO public.products (restaurant_id, category_id, name, description, price, image_url, popular, available)
    VALUES
      (rid, cat_plat, 'Diri Blan ak Sòs Pwa', 'Diri blan cho ak sòs pwa nwa, bannann peze.', 300,
       '/__l5e/assets-v1/0e046822-8014-435f-93a6-9ece6364658e/diri-sospwa.webp', true, true),
      (rid, cat_plat, 'Kalalou ak Diri', 'Diri blan avèk kalalou fre, sòs epise.', 350,
       '/__l5e/assets-v1/be200713-1545-412c-8be1-2386ad40a316/diri-kalalou.webp', true, true),
      (rid, cat_plat, 'Lalo ak Krab', 'Lalo tradisyonèl ak krab ak vyann kochon.', 550,
       '/__l5e/assets-v1/752694ab-b455-46f1-95c9-55c84da9fb62/lalo.webp', false, true)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Fritay konplè for Griyo Express
  SELECT id INTO rid FROM public.restaurants WHERE slug = 'griyo-express';
  IF rid IS NOT NULL THEN
    SELECT id INTO cat_plat FROM public.menu_categories WHERE restaurant_id = rid ORDER BY sort_order LIMIT 1;
    INSERT INTO public.products (restaurant_id, category_id, name, description, price, image_url, popular, available)
    VALUES
      (rid, cat_plat, 'Fritay Konplè', 'Griyo, marinad, akra, bannann peze ak pikliz.', 500,
       '/__l5e/assets-v1/21555bbd-8e8f-4e13-b88e-2e30aba50089/fritay.webp', true, true)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
