-- Workspace switch latency telemetry for p50/p95 budget monitoring.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.workspace_switch_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  from_org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  to_org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  success BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL DEFAULT 'dashboard',
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_switch_events_user_created_at
  ON public.workspace_switch_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_switch_events_created_at
  ON public.workspace_switch_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_switch_events_success_created_at
  ON public.workspace_switch_events(success, created_at DESC);

ALTER TABLE public.workspace_switch_events ENABLE ROW LEVEL SECURITY;
