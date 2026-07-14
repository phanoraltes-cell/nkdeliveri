-- Performance remediation (Phase 3, item 6): the foreign-key columns below
-- have never had an index (verified against the full migration history —
-- only 14 explicit indexes exist anywhere), yet every one of them is
-- filtered on in a query already live in the app:
--   - order_items.order_id  : order detail pages, receipt/PDF export
--   - order_items.product_id: menu "N sold" style rollups if ever added
--   - payments.order_id     : order detail pages, payment status lookups
--   - payment_proofs.payment_id : orders.$id.tsx proof gallery
--   - deliveries.driver_id  : driver history/earnings, admin live map
--   - deliveries.status     : driver "available deliveries" queries
--   - reviews.restaurant_id / .driver_id / .customer_id : restaurant page
--     reviews list, driver rating average, "my reviews"
--   - addresses.user_id     : "my addresses" on checkout/profile
-- None of these are large tables yet, so a sequential scan is currently
-- fast — but every one of the queries above is on a user-facing path that
-- gets slower in direct proportion to table size with no index, and
-- retrofitting an index on a multi-million-row table later means either a
-- lock window or CONCURRENTLY-building infra this project doesn't have yet.
-- Cheaper to add them now while the tables are small.

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON public.order_items(product_id);

CREATE INDEX IF NOT EXISTS idx_payments_order_id ON public.payments(order_id);

CREATE INDEX IF NOT EXISTS idx_payment_proofs_payment_id ON public.payment_proofs(payment_id);

CREATE INDEX IF NOT EXISTS idx_deliveries_driver_id ON public.deliveries(driver_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON public.deliveries(status);

CREATE INDEX IF NOT EXISTS idx_reviews_restaurant_id ON public.reviews(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_reviews_driver_id ON public.reviews(driver_id);
CREATE INDEX IF NOT EXISTS idx_reviews_customer_id ON public.reviews(customer_id);

CREATE INDEX IF NOT EXISTS idx_addresses_user_id ON public.addresses(user_id);

-- favorites.restaurant_id: idx_favorites_user already covers user_id;
-- restaurant_id (e.g. "how many users favorited this restaurant") has no
-- index at all.
CREATE INDEX IF NOT EXISTS idx_favorites_restaurant_id ON public.favorites(restaurant_id);

-- restaurant_employees.user_id: the (restaurant_id, user_id) unique
-- constraint gives an implicit composite index usable for restaurant_id
-- lookups, but not for "which restaurants does this user staff" (used by
-- the "orders read" RLS policy's staff-visibility clause on every order
-- read by a restaurant_staff account).
CREATE INDEX IF NOT EXISTS idx_restaurant_employees_user_id ON public.restaurant_employees(user_id);
