
-- Add covering indexes for all unindexed foreign keys
CREATE INDEX IF NOT EXISTS idx_github_capture_queue_reviewed_by
  ON public.github_capture_queue (reviewed_by);

CREATE INDEX IF NOT EXISTS idx_integration_secret_refs_created_by_user_id
  ON public.integration_secret_refs (created_by_user_id);

CREATE INDEX IF NOT EXISTS idx_integration_secret_refs_updated_by_user_id
  ON public.integration_secret_refs (updated_by_user_id);

CREATE INDEX IF NOT EXISTS idx_legacy_route_usage_events_owner_user_id
  ON public.legacy_route_usage_events (owner_user_id);

CREATE INDEX IF NOT EXISTS idx_org_invites_invited_by
  ON public.org_invites (invited_by);

CREATE INDEX IF NOT EXISTS idx_org_members_invited_by
  ON public.org_members (invited_by);

CREATE INDEX IF NOT EXISTS idx_sdk_embedding_meter_events_owner_org_id
  ON public.sdk_embedding_meter_events (owner_org_id);

CREATE INDEX IF NOT EXISTS idx_sdk_embedding_meter_events_owner_user_id
  ON public.sdk_embedding_meter_events (owner_user_id);

CREATE INDEX IF NOT EXISTS idx_sdk_project_meter_events_owner_org_id
  ON public.sdk_project_meter_events (owner_org_id);

CREATE INDEX IF NOT EXISTS idx_sdk_project_meter_events_owner_user_id
  ON public.sdk_project_meter_events (owner_user_id);

CREATE INDEX IF NOT EXISTS idx_sdk_tenant_databases_created_by_user_id
  ON public.sdk_tenant_databases (created_by_user_id);

CREATE INDEX IF NOT EXISTS idx_workspace_switch_events_from_org_id
  ON public.workspace_switch_events (from_org_id);

CREATE INDEX IF NOT EXISTS idx_workspace_switch_events_to_org_id
  ON public.workspace_switch_events (to_org_id);

CREATE INDEX IF NOT EXISTS idx_workspace_switch_profile_events_from_org_id
  ON public.workspace_switch_profile_events (from_org_id);

CREATE INDEX IF NOT EXISTS idx_workspace_switch_profile_events_to_org_id
  ON public.workspace_switch_profile_events (to_org_id);
;
