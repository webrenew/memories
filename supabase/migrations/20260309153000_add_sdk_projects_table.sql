-- Workspace-scoped AI SDK project registry for the dashboard.
-- A project corresponds to a tenantId boundary plus human-readable metadata.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.sdk_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_scope_key TEXT NOT NULL,
  owner_type TEXT NOT NULL,
  owner_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  owner_org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  tenant_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sdk_projects_owner_type_check
    CHECK (owner_type IN ('user', 'organization')),
  CONSTRAINT sdk_projects_owner_scope_key_non_empty
    CHECK (char_length(trim(owner_scope_key)) > 0),
  CONSTRAINT sdk_projects_tenant_id_non_empty
    CHECK (char_length(trim(tenant_id)) > 0),
  CONSTRAINT sdk_projects_display_name_non_empty
    CHECK (char_length(trim(display_name)) > 0),
  CONSTRAINT sdk_projects_owner_columns_match_type
    CHECK (
      (owner_type = 'user' AND owner_user_id IS NOT NULL AND owner_org_id IS NULL)
      OR
      (owner_type = 'organization' AND owner_org_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sdk_projects_owner_scope_tenant_unique
  ON public.sdk_projects (owner_scope_key, tenant_id);

CREATE INDEX IF NOT EXISTS idx_sdk_projects_owner_scope_created_at
  ON public.sdk_projects (owner_scope_key, created_at DESC);

ALTER TABLE public.sdk_projects ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sdk_projects'
      AND policyname = 'Service role full access sdk_projects'
  ) THEN
    CREATE POLICY "Service role full access sdk_projects"
      ON public.sdk_projects
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END;
$$;
