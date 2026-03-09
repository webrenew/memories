-- Fix remaining RLS initplan policies to wrap auth.role() in (SELECT ...)
DROP POLICY "Service role full access workspace db provision locks" ON public.workspace_db_provision_locks;
CREATE POLICY "Service role full access workspace db provision locks"
  ON public.workspace_db_provision_locks FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

DROP POLICY "Service role full access stripe customer provision locks" ON public.stripe_customer_provision_locks;
CREATE POLICY "Service role full access stripe customer provision locks"
  ON public.stripe_customer_provision_locks FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

DROP POLICY "Service role full access stripe webhook events" ON public.stripe_webhook_events;
CREATE POLICY "Service role full access stripe webhook events"
  ON public.stripe_webhook_events FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

DROP POLICY "Service role full access stripe webhook scopes" ON public.stripe_webhook_scopes;
CREATE POLICY "Service role full access stripe webhook scopes"
  ON public.stripe_webhook_scopes FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- Add missing foreign-key indexes for lock tables.
CREATE INDEX IF NOT EXISTS idx_stripe_cpl_locked_by
  ON public.stripe_customer_provision_locks (locked_by_user_id);

CREATE INDEX IF NOT EXISTS idx_stripe_cpl_owner_org
  ON public.stripe_customer_provision_locks (owner_org_id);

CREATE INDEX IF NOT EXISTS idx_stripe_cpl_owner_user
  ON public.stripe_customer_provision_locks (owner_user_id);

CREATE INDEX IF NOT EXISTS idx_wdpl_locked_by
  ON public.workspace_db_provision_locks (locked_by_user_id);

CREATE INDEX IF NOT EXISTS idx_wdpl_owner_org
  ON public.workspace_db_provision_locks (owner_org_id);

CREATE INDEX IF NOT EXISTS idx_wdpl_owner_user
  ON public.workspace_db_provision_locks (owner_user_id);

-- Drop the duplicate organizations slug index and keep the unique constraint index.
DROP INDEX IF EXISTS public.idx_organizations_slug_unique;
