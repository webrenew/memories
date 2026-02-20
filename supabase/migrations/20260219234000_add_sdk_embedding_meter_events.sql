-- Embedding usage pricing ledger + metering for hosted SDK.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.sdk_embedding_meter_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_scope_key TEXT NOT NULL,
  owner_type TEXT NOT NULL DEFAULT 'user',
  owner_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  owner_org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  stripe_customer_id TEXT,
  api_key_hash TEXT NOT NULL,
  tenant_id TEXT,
  project_id TEXT,
  user_id TEXT,
  usage_month DATE NOT NULL,
  request_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_identifier TEXT NOT NULL UNIQUE,
  event_value BIGINT NOT NULL DEFAULT 0 CHECK (event_value >= 0),
  model_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  gateway_cost_usd NUMERIC(14, 8),
  market_cost_usd NUMERIC(14, 8),
  customer_cost_usd NUMERIC(14, 8) NOT NULL DEFAULT 0,
  estimated_cost BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  stripe_reported_at TIMESTAMPTZ,
  stripe_last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sdk_embedding_meter_events_owner_type_check
    CHECK (owner_type IN ('user', 'organization')),
  CONSTRAINT sdk_embedding_meter_events_owner_scope_key_non_empty
    CHECK (char_length(trim(owner_scope_key)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_sdk_embedding_meter_events_owner_scope_month
  ON public.sdk_embedding_meter_events (owner_scope_key, usage_month);

CREATE INDEX IF NOT EXISTS idx_sdk_embedding_meter_events_tenant_month
  ON public.sdk_embedding_meter_events (tenant_id, usage_month)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sdk_embedding_meter_events_project_month
  ON public.sdk_embedding_meter_events (project_id, usage_month)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sdk_embedding_meter_events_model_month
  ON public.sdk_embedding_meter_events (model_id, usage_month);

CREATE INDEX IF NOT EXISTS idx_sdk_embedding_meter_events_stripe_reported
  ON public.sdk_embedding_meter_events (stripe_reported_at);

CREATE INDEX IF NOT EXISTS idx_sdk_embedding_meter_events_api_key_hash
  ON public.sdk_embedding_meter_events (api_key_hash);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sdk_embedding_meter_events_owner_request_unique
  ON public.sdk_embedding_meter_events (owner_scope_key, request_id, model_id);

ALTER TABLE public.sdk_embedding_meter_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sdk_embedding_meter_events'
      AND policyname = 'Service role full access sdk_embedding_meter_events'
  ) THEN
    CREATE POLICY "Service role full access sdk_embedding_meter_events"
      ON public.sdk_embedding_meter_events
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END;
$$;
