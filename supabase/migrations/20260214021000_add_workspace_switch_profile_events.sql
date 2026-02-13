-- Deep workspace-switch profiling for large-tenant diagnostics and cache tuning.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.workspace_switch_profile_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  from_org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  to_org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  success BOOLEAN NOT NULL DEFAULT true,
  error_code TEXT,
  source TEXT NOT NULL DEFAULT 'dashboard',
  cache_mode TEXT,
  include_summaries BOOLEAN NOT NULL DEFAULT false,
  client_total_ms INTEGER,
  user_patch_ms INTEGER,
  workspace_prefetch_ms INTEGER,
  integration_health_prefetch_ms INTEGER,
  workspace_summary_total_ms INTEGER,
  workspace_summary_query_ms INTEGER,
  workspace_summary_org_count INTEGER,
  workspace_summary_workspace_count INTEGER,
  workspace_summary_response_bytes INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workspace_switch_profile_events_client_total_ms_check CHECK (client_total_ms IS NULL OR client_total_ms >= 0),
  CONSTRAINT workspace_switch_profile_events_user_patch_ms_check CHECK (user_patch_ms IS NULL OR user_patch_ms >= 0),
  CONSTRAINT workspace_switch_profile_events_workspace_prefetch_ms_check CHECK (workspace_prefetch_ms IS NULL OR workspace_prefetch_ms >= 0),
  CONSTRAINT workspace_switch_profile_events_integration_health_prefetch_ms_check CHECK (integration_health_prefetch_ms IS NULL OR integration_health_prefetch_ms >= 0),
  CONSTRAINT workspace_switch_profile_events_workspace_summary_total_ms_check CHECK (workspace_summary_total_ms IS NULL OR workspace_summary_total_ms >= 0),
  CONSTRAINT workspace_switch_profile_events_workspace_summary_query_ms_check CHECK (workspace_summary_query_ms IS NULL OR workspace_summary_query_ms >= 0),
  CONSTRAINT workspace_switch_profile_events_workspace_summary_org_count_check CHECK (workspace_summary_org_count IS NULL OR workspace_summary_org_count >= 0),
  CONSTRAINT workspace_switch_profile_events_workspace_summary_workspace_count_check CHECK (workspace_summary_workspace_count IS NULL OR workspace_summary_workspace_count >= 0),
  CONSTRAINT workspace_switch_profile_events_workspace_summary_response_bytes_check CHECK (workspace_summary_response_bytes IS NULL OR workspace_summary_response_bytes >= 0)
);

CREATE INDEX IF NOT EXISTS idx_workspace_switch_profile_events_user_created_at
  ON public.workspace_switch_profile_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_switch_profile_events_org_count_created_at
  ON public.workspace_switch_profile_events(workspace_summary_org_count, created_at DESC)
  WHERE workspace_summary_org_count IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_switch_profile_events_success_created_at
  ON public.workspace_switch_profile_events(success, created_at DESC);

ALTER TABLE public.workspace_switch_profile_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workspace_switch_profile_events'
      AND policyname = 'Service role full access workspace switch profile events'
  ) THEN
    CREATE POLICY "Service role full access workspace switch profile events"
      ON public.workspace_switch_profile_events FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$$;
