-- Critical fix: payment-proofs, restaurant-assets, and driver-documents were
-- never created via a tracked migration — they were set up by hand in the
-- original Supabase project (only their storage.objects RLS policies were
-- ever committed, e.g. 20260703055139 / 20260703063943). On the new project,
-- db push replayed every policy but there was no bucket for any of them to
-- attach to, so all three have been silently missing:
--   - payment-proofs: customers cannot upload MonCash/NatCash payment proof
--   - restaurant-assets: restaurant logo/cover upload is broken
--   - driver-documents: driver ID/license/vehicle photo upload is broken
-- (user-avatars is deliberately NOT recreated here — nothing in the current
-- codebase references that bucket name; the customer profile feature uses
-- the separate `avatars` bucket created in 20260704180000.)

INSERT INTO storage.buckets (id, name, public) VALUES
  ('payment-proofs', 'payment-proofs', false),
  ('restaurant-assets', 'restaurant-assets', true),
  ('driver-documents', 'driver-documents', false)
ON CONFLICT (id) DO NOTHING;
