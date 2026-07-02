
# NK Delivery — Plan konplè

Aplikasyon an ap sou TanStack Start + Lovable Cloud (Supabase). Enterfas nan Kreyòl Ayisyen. Design egzakteman jan prototip HTML la ye (palèt zoranj/krèm, Bricolage Grotesque + Instrument Sans).

## 1. Design system (baze sou prototip la)
- Koulè: `--orange #E8720C`, `--orange-deep #C25A05`, `--orange-soft #FDE8D4`, `--cream #FFF8F1`, `--ink #2B1A0E`, `--ink-soft #7A6350`.
- Font: Bricolage Grotesque (tit), Instrument Sans (kò), enstale via `@fontsource`.
- Radius 18px, shadow zoranj dous, badges pill, koub "sourire NK" kòm separatè.
- Tout tokens ap ale nan `src/styles.css` (semantic tokens, pa gen koulè kode nan konpozan).

## 2. Backend (Lovable Cloud / Supabase)

### Otantifikasyon
- Google OAuth (via `lovable.auth.signInWithOAuth("google")`) + email/password fallback.
- Trigger `handle_new_user` kreye yon liy nan `profiles` epi bay wòl `customer` pa defo.

### Wòl (tab separe pou sekirite)
- `app_role` enum: `customer`, `restaurant_owner`, `restaurant_staff`, `driver`, `admin`, `super_admin`.
- Tab `user_roles` + fonksyon `has_role(uuid, app_role)` SECURITY DEFINER.
- Tout politik RLS itilize `has_role()`, pa janm koloni sou `profiles`.

### Modèl done (tab prensipal, tout ak RLS + GRANT)
- `profiles` (id, first_name, last_name, phone, address, avatar_url)
- `restaurants` (owner_id, name, description, logo, cover, address, lat, lng, opening_hours jsonb, status: pending/approved/suspended, commission_rate)
- `restaurant_staff` (restaurant_id, user_id, role: manager/cashier/preparer)
- `menu_categories` (restaurant_id, name, sort_order)
- `products` (restaurant_id, category_id, name, description, price, image, available, stock)
- `carts` / `cart_items` (client-side + persisted pou itilizatè otantifye)
- `orders` (customer_id, restaurant_id, driver_id, subtotal, delivery_fee, total, status enum, delivery_address, notes, created_at)
- `order_items` (order_id, product_id, qty, unit_price, comment)
- `order_status_history` (pou suiv tan reyèl)
- `payments` (order_id, method: stripe/moncash/natcash/cash, status: pending/awaiting_verification/paid/refused, transaction_ref, proof_url, verified_by, verified_at)
- `deliveries` (order_id, driver_id, status, pickup_time, delivery_time, gps_track jsonb)
- `drivers` (user_id, id_document_url, vehicle_type, plate, availability: available/busy/offline, current_lat, current_lng)
- `reviews` (customer_id, restaurant_id, order_id, rating, comment)
- `promo_codes`, `loyalty_points`, `notifications` (fas 2 si tan ap pèmèt)
- Storage buckets: `restaurant-media`, `product-images`, `payment-proofs` (prive), `driver-documents` (prive).

### Server functions (`createServerFn`)
- `getRestaurants`, `getRestaurant(slug)`, `getMenu(restaurantId)` — piblik (RLS `TO anon`).
- `createOrder`, `getMyOrders`, `getOrder(id)` — otantifye kliyan.
- `restaurantAcceptOrder`, `restaurantUpdateStatus` — wòl restaurant_owner/staff.
- `driverAcceptDelivery`, `driverUpdateLocation`, `driverCompleteDelivery` — wòl driver.
- `adminApproveRestaurant`, `adminVerifyPayment`, `adminSuspendUser` — wòl admin.
- Peman: `createStripeCheckout`, `submitManualPaymentProof`.
- Webhook Stripe nan `src/routes/api/public/stripe-webhook.ts` ak verifikasyon siyati HMAC.

## 3. Peman

### Stripe (kat otomatik)
- Aktive via `enable_stripe_payments` (Lovable-managed).
- Kreye pwodwi/pri dinamikman pou chak commande (line items ad-hoc).
- Webhook mete `payments.status = 'paid'` epi otomatik `orders.status = 'accepted'`.

### MonCash & NatCash (manyèl)
- UI checkout: chwazi metòd → montre enstriksyon (nimewo pou voye lajan) → upload prèv (foto/kaptür) → soumèt.
- `payments.status = 'awaiting_verification'`, `orders.status = 'pending_payment_verification'`.
- Admin back-office wè lis peman ki tann, gade prèv la (signed URL), apwouve/refize.
- Sou apwobasyon: peman = paid, kòmand pase nan flow nòmal la (restoran resevwa notifikasyon).

## 4. Woutin / paj (TanStack file-based)

### Piblik
- `/` — Home (hero, chèche, kategori, restoran popilè, plat popilè) — replike prototip la.
- `/restaurants` — lis konplè ak filtè.
- `/restaurants/$slug` — meni yon restoran.
- `/auth` — konekte / enskri (Google + email).
- `/about`, `/contact`, `/terms`, `/privacy` — paj estatik SEO.

### Kliyan (`_authenticated/`)
- `/checkout` — panye + adrès + chwa peman.
- `/payment/$orderId` — konfimasyon / upload prèv MonCash-NatCash.
- `/orders` — istwa kòmand.
- `/orders/$id` — suiv tan reyèl (etap, livrè, kat).
- `/profile` — enfo pèsonèl, adrès sove.

### Restoran (`_authenticated/restaurant/`)
- `/restaurant` — dashboard (KPI: revni jou, kòmand, tikèt mwayen).
- `/restaurant/menu` — CRUD kategori + pwodwi (avèk upload foto).
- `/restaurant/orders` — kòmand k ap rantre (accept/refuse/prepare/ready).
- `/restaurant/staff` — jere anplwaye.
- `/restaurant/settings` — enfo, orè, logo, kouvèti.

### Livrè (`_authenticated/driver/`)
- `/driver` — kous disponib + estati (available/busy/offline).
- `/driver/current` — kous aktyèl (kat, kliyan, restoran).
- `/driver/history` — istwa + revni.
- `/driver/profile` — dokiman, veyikil.

### Admin (`_authenticated/admin/`)
- `/admin` — dashboard global.
- `/admin/restaurants` — apwobasyon + jesyon.
- `/admin/users` — kliyan/livrè/admin.
- `/admin/payments` — **validasyon prèv MonCash/NatCash** (priyorite MVP).
- `/admin/orders` — vi konplè.
- `/admin/reports` — rapò jounalye/semèn/mwa.

## 5. Real-time
- Supabase Realtime sou `orders` ak `order_status_history` pou:
  - Restoran resevwa nouvo kòmand imedyatman.
  - Kliyan wè estati chanje san refresh.
  - Livrè jwenn kous ki disponib.

## 6. Sekirite
- Tout tab: RLS aktive + GRANT eksplisit.
- Wòl nan tab separe + `has_role()` SECURITY DEFINER.
- Peman/prèv: bucket prive, signed URLs sèlman.
- Validation Zod tou de bò (kliyan + server functions).
- Webhook Stripe: verifikasyon siyati timing-safe.

## 7. Faz devlopman (ap fèt an plizyè iterasyon apre plan an apwouve)

**Iterasyon 1 — Fondasyon + Kliyan public**
Design tokens, `__root` ak header/footer, home, lis restoran, meni, panye (localStorage), Cloud + auth Google, tab `profiles` + `user_roles`, seed 4-5 restoran demo.

**Iterasyon 2 — Kòmand + Peman**
Schema `orders/payments/deliveries`, checkout, Stripe integration + webhook, flow MonCash/NatCash ak upload prèv, paj suiv kòmand.

**Iterasyon 3 — Portail Restoran**
Dashboard, CRUD meni, kòmand tan reyèl, anplwaye.

**Iterasyon 4 — Portail Livrè**
Enskripsyon livrè, disponiblite, aksepte kous, suiv GPS senp.

**Iterasyon 5 — Admin**
Apwobasyon restoran, validasyon peman manyèl (kritik), rapò.

## Detay teknik (rezime)
- Stack: TanStack Start + React 19 + Tailwind v4 + shadcn/ui.
- Backend: Lovable Cloud (Supabase) — DB, Auth, Storage, Realtime.
- Peman: `enable_stripe_payments` (auto) + tab `payments` maison pou MonCash/NatCash.
- OAuth: `supabase--configure_social_auth` pou Google.
- Server logic: `createServerFn` (pa Edge Functions) + `/api/public/stripe-webhook` pou webhook.
- I18n: tout tèks nan Kreyòl direkteman nan konpozan (yon `src/lib/i18n.ts` senp si nesesè pi ta).

Lè w apwouve plan an, m ap kòmanse pa Iterasyon 1.
