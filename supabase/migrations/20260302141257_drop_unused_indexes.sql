
-- Drop 39 unused indexes to reduce write overhead and storage

-- legacy_route_usage_events (3)
DROP INDEX IF EXISTS public.idx_legacy_route_usage_events_route_created_at;
DROP INDEX IF EXISTS public.idx_legacy_route_usage_events_created_at;
DROP INDEX IF EXISTS public.idx_legacy_route_usage_events_success_created_at;

-- org_invites (1)
DROP INDEX IF EXISTS public.idx_org_invites_email;

-- workspace_switch_events (2)
DROP INDEX IF EXISTS public.idx_workspace_switch_events_success_created_at;
DROP INDEX IF EXISTS public.idx_workspace_switch_events_created_at;

-- sdk_tenant_databases (4)
DROP INDEX IF EXISTS public.idx_sdk_tenant_databases_stripe_customer_id;
DROP INDEX IF EXISTS public.idx_sdk_tenant_databases_billing_owner_user_id;
DROP INDEX IF EXISTS public.idx_sdk_tenant_databases_billing_org_id;
DROP INDEX IF EXISTS public.idx_sdk_tenant_databases_mapping_source;

-- users (5)
DROP INDEX IF EXISTS public.idx_users_current_org_id;
DROP INDEX IF EXISTS public.idx_users_stripe_customer_id;
DROP INDEX IF EXISTS public.idx_users_cli_token;
DROP INDEX IF EXISTS public.idx_users_cli_auth_code;
DROP INDEX IF EXISTS public.idx_users_cli_auth_expires_at;

-- github_capture_settings (2)
DROP INDEX IF EXISTS public.idx_github_capture_settings_target_user;
DROP INDEX IF EXISTS public.idx_github_capture_settings_target_org;

-- github_capture_queue (3)
DROP INDEX IF EXISTS public.idx_github_capture_queue_source_event_created_at;
DROP INDEX IF EXISTS public.idx_github_capture_queue_repo_created_at;
DROP INDEX IF EXISTS public.idx_github_capture_queue_actor_created_at;

-- organizations (1)
DROP INDEX IF EXISTS public.idx_organizations_owner;

-- workspace_switch_profile_events (2)
DROP INDEX IF EXISTS public.idx_workspace_switch_profile_events_org_count_created_at;
DROP INDEX IF EXISTS public.idx_workspace_switch_profile_events_success_created_at;

-- org_audit_logs (2)
DROP INDEX IF EXISTS public.idx_org_audit_logs_org_action_created_at;
DROP INDEX IF EXISTS public.idx_org_audit_logs_actor_created_at;

-- integration_secret_refs (3)
DROP INDEX IF EXISTS public.idx_integration_secret_refs_user_lookup;
DROP INDEX IF EXISTS public.idx_integration_secret_refs_org_lookup;
DROP INDEX IF EXISTS public.idx_integration_secret_refs_vault_secret_id;

-- sdk_project_meter_events (3)
DROP INDEX IF EXISTS public.idx_sdk_project_meter_events_api_key_hash;
DROP INDEX IF EXISTS public.idx_sdk_project_meter_events_usage_month;
DROP INDEX IF EXISTS public.idx_sdk_project_meter_events_stripe_reported_at;

-- sdk_embedding_meter_events (8)
DROP INDEX IF EXISTS public.idx_sdk_embedding_meter_events_owner_scope_month;
DROP INDEX IF EXISTS public.idx_sdk_embedding_meter_events_tenant_month;
DROP INDEX IF EXISTS public.idx_sdk_embedding_meter_events_project_month;
DROP INDEX IF EXISTS public.idx_sdk_embedding_meter_events_model_month;
DROP INDEX IF EXISTS public.idx_sdk_embedding_meter_events_stripe_reported;
DROP INDEX IF EXISTS public.idx_sdk_embedding_meter_events_api_key_hash;
DROP INDEX IF EXISTS public.idx_sdk_embedding_meter_events_token_method_month;
DROP INDEX IF EXISTS public.idx_sdk_embedding_meter_events_token_delta_month;

-- mcp_api_keys (1)
DROP INDEX IF EXISTS public.idx_mcp_api_keys_expires_at;
;
