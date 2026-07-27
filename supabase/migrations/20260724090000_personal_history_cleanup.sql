-- Personal history cleanup (v8 plan): lets a customer/restaurant/driver
-- hide items from their OWN view of order history and chat conversations.
-- Never a real DELETE anywhere in this migration — every table below is
-- either a self-scoped "what have I hidden" table, or a nullable
-- `hidden_at` marker column. The underlying orders/commission_ledger/
-- payouts/disputes/audit_log rows are never touched by anything here, and
-- no admin-facing query anywhere reads either of these -- admin visibility
-- is unaffected by construction, not just by convention.

-- ---------------------------------------------------------------------------
-- Orders and chat have several legitimate distinct viewers per row
-- (customer, restaurant owner/staff, assigned driver) who each need an
-- independent hide state -- a single column on `orders` couldn't express
-- that. A dedicated self-scoped table can, and — unlike almost everything
-- else in this project — doesn't need an RPC to write safely: masking a
-- row only ever affects the caller themselves, so the same
-- `FOR ALL USING/WITH CHECK (user_id = auth.uid())` shape already proven
-- by `push_subscriptions` is sufficient on its own.
CREATE TABLE public.hidden_history_items (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('order', 'chat')),
  entity_id uuid NOT NULL,
  hidden_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, entity_type, entity_id)
);
ALTER TABLE public.hidden_history_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hidden_history_items FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.hidden_history_items TO authenticated;
CREATE POLICY "hidden_history_items own" ON public.hidden_history_items FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX hidden_history_items_user_type_idx ON public.hidden_history_items(user_id, entity_type);

-- The one piece of real business-rule validation this feature needs:
-- only ever hide something you can actually see, and only once it's
-- actually finished — a "clean up my history" action must never be able
-- to make a still-active order or an open conversation quietly vanish
-- from someone's own dashboard. RLS's WITH CHECK already guarantees
-- NEW.user_id = auth.uid() by the time this fires, so the checks below
-- reuse auth.uid() directly, matching how the helpers they call were
-- already written.
CREATE OR REPLACE FUNCTION private.validate_hidden_history_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.entity_type = 'order' THEN
    -- Same visibility shape as the "orders read" RLS policy
    -- (20260709093000_...sql), plus a terminal-status requirement that
    -- policy doesn't have.
    IF NOT EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = NEW.entity_id
        AND o.status IN ('delivered', 'cancelled', 'refunded')
        AND (
          o.customer_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = o.restaurant_id AND r.owner_id = auth.uid())
          OR EXISTS (SELECT 1 FROM public.restaurant_employees e WHERE e.restaurant_id = o.restaurant_id AND e.user_id = auth.uid())
          OR private.order_visible_to_driver(o.id, o.status)
        )
    ) THEN
      RAISE EXCEPTION 'Ou pa ka kache kòmand sa a' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.entity_type = 'chat' THEN
    IF private.order_chat_author_role(NEW.entity_id) IS NULL THEN
      RAISE EXCEPTION 'Ou pa gen aksè a chat sa a' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = NEW.entity_id
        AND o.status IN ('confirmed', 'preparing', 'ready', 'assigned', 'picked_up')
    ) THEN
      RAISE EXCEPTION 'Ou pa ka kache yon konvèsasyon ki toujou aktif';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_hidden_history_item ON public.hidden_history_items;
CREATE TRIGGER trg_validate_hidden_history_item
  BEFORE INSERT ON public.hidden_history_items
  FOR EACH ROW EXECUTE FUNCTION private.validate_hidden_history_item();

-- ---------------------------------------------------------------------------
-- Notifications: one row already belongs to exactly one user (unlike an
-- order), and the table already has direct client-write RLS ("notif own",
-- FOR ALL), so a plain nullable column — mirroring the one existing
-- soft-delete precedent in this codebase, `products.archived_at` — is the
-- simplest, most consistent fit. No new table, no new policy, no trigger.
ALTER TABLE public.notifications ADD COLUMN hidden_at timestamptz;
CREATE INDEX notifications_user_hidden_idx ON public.notifications(user_id) WHERE hidden_at IS NULL;
