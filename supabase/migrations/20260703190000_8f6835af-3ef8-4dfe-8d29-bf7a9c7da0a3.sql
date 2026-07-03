
-- Point product/restaurant images at real self-hosted files in public/dishes/
-- instead of the Lovable-sandbox-only /__l5e/assets-v1/ CDN paths, which 404
-- outside Lovable's own hosting.
UPDATE public.products SET image_url = '/dishes/dirikole.webp'      WHERE name = 'Diri ak Pwa Kolé';
UPDATE public.products SET image_url = '/dishes/multi-plat.webp'    WHERE name = 'Poul nan Sòs';
UPDATE public.products SET image_url = '/dishes/diri-sospwa.webp'   WHERE name IN ('Diri Blan ak Sòs Pwa', 'Pwason Gwo Sèl');
UPDATE public.products SET image_url = '/dishes/diri-kalalou.webp'  WHERE name = 'Kalalou ak Diri';
UPDATE public.products SET image_url = '/dishes/fritay.webp'        WHERE name IN ('Griyo ak Banann', 'Tasso Kabrit', 'Fritay Konplè');
UPDATE public.products SET image_url = '/dishes/lalo.webp'          WHERE name = 'Lambi nan Sòs';
UPDATE public.products SET image_url = '/dishes/soup-joumou.webp'   WHERE name = 'Soup Joumou';

UPDATE public.restaurants SET cover_url = '/dishes/dirikole.webp'   WHERE slug = 'chez-marie';
UPDATE public.restaurants SET cover_url = '/dishes/fritay.webp'     WHERE slug = 'griyo-express';
UPDATE public.restaurants SET cover_url = '/dishes/lalo.webp'       WHERE slug = 'ocean-fresh';
UPDATE public.restaurants SET cover_url = '/dishes/multi-plat.webp' WHERE slug = 'ti-boutik-manje';
