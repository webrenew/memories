-- Add Stripe customer provisioning locks and atomic CLI approve guard.

CREATE TABLE IF NOT EXISTS public.stripe_customer_provision_locks (
  owner_key TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('user', 'organization')),
  owner_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  owner_org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  locked_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stripe_customer_provision_locks_owner_check CHECK (
    (owner_type = 'user' AND owner_user_id IS NOT NULL AND owner_org_id IS NULL)
    OR
    (owner_type = 'organization' AND owner_org_id IS NOT NULL AND owner_user_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_stripe_customer_provision_locks_created_at
  ON public.stripe_customer_provision_locks (created_at);

ALTER TABLE public.stripe_customer_provision_locks ENABLE ROW LEVEL SECURITY;

DO $stripe_lock_policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'stripe_customer_provision_locks'
      AND policyname = 'Service role full access stripe customer provision locks'
  ) THEN
    CREATE POLICY "Service role full access stripe customer provision locks"
      ON public.stripe_customer_provision_locks FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$stripe_lock_policy$;

DO $approve_cli_auth$
BEGIN
  EXECUTE $create_fn$
    CREATE OR REPLACE FUNCTION public.approve_cli_auth_code_atomic(
      p_user_id UUID,
      p_code TEXT,
      p_expires_at TIMESTAMPTZ
    ) RETURNS TEXT
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $fn$
    DECLARE
      v_current_code TEXT;
      v_current_expires_at TIMESTAMPTZ;
    BEGIN
      SELECT cli_auth_code, cli_auth_expires_at
      INTO v_current_code, v_current_expires_at
      FROM public.users
      WHERE id = p_user_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RETURN 'user_not_found';
      END IF;

      IF v_current_code IS NOT NULL
         AND v_current_code <> p_code
         AND (v_current_expires_at IS NULL OR v_current_expires_at > now()) THEN
        RETURN 'code_in_use';
      END IF;

      UPDATE public.users
      SET
        cli_auth_code = p_code,
        cli_auth_expires_at = p_expires_at
      WHERE id = p_user_id;

      RETURN 'updated';
    END;
    $fn$;
  $create_fn$;

  EXECUTE 'ALTER FUNCTION public.approve_cli_auth_code_atomic(UUID, TEXT, TIMESTAMPTZ) SET search_path = public';
  EXECUTE 'REVOKE ALL ON FUNCTION public.approve_cli_auth_code_atomic(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.approve_cli_auth_code_atomic(UUID, TEXT, TIMESTAMPTZ) TO service_role';
END
$approve_cli_auth$;
