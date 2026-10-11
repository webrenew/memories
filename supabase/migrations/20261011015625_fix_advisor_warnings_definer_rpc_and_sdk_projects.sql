-- Clear Supabase advisor warnings (security 0028/0029, performance 0001/0003).

-- RLS helper functions take an arbitrary uid, so exposing them via
-- /rest/v1/rpc let any caller enumerate another user's orgs and admin status.
-- Move them out of the API-exposed schema. Policies reference functions by OID,
-- so existing policies keep working. authenticated keeps EXECUTE because its
-- RLS policies call these helpers.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

ALTER FUNCTION public.get_user_org_ids(UUID) SET SCHEMA private;
ALTER FUNCTION public.is_org_admin(UUID, UUID) SET SCHEMA private;

REVOKE ALL ON FUNCTION private.get_user_org_ids(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_org_admin(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.get_user_org_ids(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_org_admin(UUID, UUID) TO authenticated, service_role;

-- Trigger-only function; EXECUTE is not checked when the trigger fires.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Wrap auth.role() in (SELECT ...) so it is evaluated once per statement.
DROP POLICY IF EXISTS "Service role full access sdk_projects" ON public.sdk_projects;
CREATE POLICY "Service role full access sdk_projects"
  ON public.sdk_projects FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- Cover sdk_projects foreign keys.
CREATE INDEX IF NOT EXISTS idx_sdk_projects_owner_user_id
  ON public.sdk_projects (owner_user_id);

CREATE INDEX IF NOT EXISTS idx_sdk_projects_owner_org_id
  ON public.sdk_projects (owner_org_id);

CREATE INDEX IF NOT EXISTS idx_sdk_projects_created_by_user_id
  ON public.sdk_projects (created_by_user_id);
