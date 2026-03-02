-- Add Stripe webhook idempotency and ordering guards.

CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  stripe_created_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.stripe_webhook_scopes (
  scope_type TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  last_event_id TEXT NOT NULL,
  last_event_created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_type, scope_key)
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_created_at
  ON public.stripe_webhook_events (stripe_created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_scopes_updated_at
  ON public.stripe_webhook_scopes (updated_at DESC);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_webhook_scopes ENABLE ROW LEVEL SECURITY;

DO $stripe_webhook_policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'stripe_webhook_events'
      AND policyname = 'Service role full access stripe webhook events'
  ) THEN
    CREATE POLICY "Service role full access stripe webhook events"
      ON public.stripe_webhook_events FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'stripe_webhook_scopes'
      AND policyname = 'Service role full access stripe webhook scopes'
  ) THEN
    CREATE POLICY "Service role full access stripe webhook scopes"
      ON public.stripe_webhook_scopes FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$stripe_webhook_policy$;

DO $claim_stripe_webhook_event$
BEGIN
  EXECUTE $create_fn$
    CREATE OR REPLACE FUNCTION public.claim_stripe_webhook_event(
      p_event_id TEXT,
      p_event_type TEXT,
      p_event_created_at TIMESTAMPTZ,
      p_scope_type TEXT DEFAULT NULL,
      p_scope_key TEXT DEFAULT NULL
    ) RETURNS TEXT
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $fn$
    BEGIN
      IF p_event_id IS NULL OR p_event_type IS NULL OR p_event_created_at IS NULL THEN
        RETURN 'invalid';
      END IF;

      INSERT INTO public.stripe_webhook_events (event_id, event_type, stripe_created_at)
      VALUES (p_event_id, p_event_type, p_event_created_at)
      ON CONFLICT (event_id) DO NOTHING;

      IF NOT FOUND THEN
        RETURN 'duplicate';
      END IF;

      IF p_scope_type IS NULL OR p_scope_key IS NULL THEN
        RETURN 'claimed';
      END IF;

      INSERT INTO public.stripe_webhook_scopes (
        scope_type,
        scope_key,
        last_event_id,
        last_event_created_at,
        updated_at
      )
      VALUES (
        p_scope_type,
        p_scope_key,
        p_event_id,
        p_event_created_at,
        now()
      )
      ON CONFLICT (scope_type, scope_key) DO UPDATE
      SET
        last_event_id = EXCLUDED.last_event_id,
        last_event_created_at = EXCLUDED.last_event_created_at,
        updated_at = now()
      WHERE
        EXCLUDED.last_event_created_at > public.stripe_webhook_scopes.last_event_created_at
        OR (
          EXCLUDED.last_event_created_at = public.stripe_webhook_scopes.last_event_created_at
          AND EXCLUDED.last_event_id > public.stripe_webhook_scopes.last_event_id
        );

      IF NOT FOUND THEN
        RETURN 'stale';
      END IF;

      RETURN 'claimed';
    END;
    $fn$;
  $create_fn$;

  EXECUTE 'ALTER FUNCTION public.claim_stripe_webhook_event(TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT) SET search_path = public';
  EXECUTE 'REVOKE ALL ON FUNCTION public.claim_stripe_webhook_event(TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.claim_stripe_webhook_event(TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT) TO service_role';
END
$claim_stripe_webhook_event$;
