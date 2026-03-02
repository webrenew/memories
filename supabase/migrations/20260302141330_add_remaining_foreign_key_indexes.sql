
-- Add indexes for FKs that lost coverage when we dropped unused indexes
CREATE INDEX IF NOT EXISTS idx_github_capture_settings_target_org_id
  ON public.github_capture_settings (target_org_id);

CREATE INDEX IF NOT EXISTS idx_github_capture_settings_target_user_id
  ON public.github_capture_settings (target_user_id);

CREATE INDEX IF NOT EXISTS idx_integration_secret_refs_target_org_id
  ON public.integration_secret_refs (target_org_id);

CREATE INDEX IF NOT EXISTS idx_integration_secret_refs_target_user_id
  ON public.integration_secret_refs (target_user_id);

CREATE INDEX IF NOT EXISTS idx_org_audit_logs_actor_user_id
  ON public.org_audit_logs (actor_user_id);

CREATE INDEX IF NOT EXISTS idx_organizations_owner_id
  ON public.organizations (owner_id);

CREATE INDEX IF NOT EXISTS idx_sdk_tenant_databases_billing_org_id
  ON public.sdk_tenant_databases (billing_org_id);

CREATE INDEX IF NOT EXISTS idx_sdk_tenant_databases_billing_owner_user_id
  ON public.sdk_tenant_databases (billing_owner_user_id);

CREATE INDEX IF NOT EXISTS idx_users_current_org_id
  ON public.users (current_org_id);
;
