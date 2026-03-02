
-- Fix auth_rls_initplan: wrap auth.uid()/auth.role() in (SELECT ...) for single evaluation
-- This prevents per-row re-evaluation of these functions

-- 1. github_account_links
DROP POLICY "Users can upsert own github account link" ON public.github_account_links;
CREATE POLICY "Users can upsert own github account link"
  ON public.github_account_links FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY "Users can view own github account link" ON public.github_account_links;
CREATE POLICY "Users can view own github account link"
  ON public.github_account_links FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- 2. github_capture_settings
DROP POLICY "Org admins can manage org github capture settings" ON public.github_capture_settings;
CREATE POLICY "Org admins can manage org github capture settings"
  ON public.github_capture_settings FOR ALL TO authenticated
  USING (
    target_owner_type = 'organization'
    AND EXISTS (
      SELECT 1 FROM org_members m
      WHERE m.org_id = github_capture_settings.target_org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.role = ANY (ARRAY['owner', 'admin'])
    )
  )
  WITH CHECK (
    target_owner_type = 'organization'
    AND EXISTS (
      SELECT 1 FROM org_members m
      WHERE m.org_id = github_capture_settings.target_org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.role = ANY (ARRAY['owner', 'admin'])
    )
  );

DROP POLICY "Users can manage own github capture settings" ON public.github_capture_settings;
CREATE POLICY "Users can manage own github capture settings"
  ON public.github_capture_settings FOR ALL TO authenticated
  USING (target_owner_type = 'user' AND target_user_id = (SELECT auth.uid()))
  WITH CHECK (target_owner_type = 'user' AND target_user_id = (SELECT auth.uid()));

-- 3. integration_secret_refs
DROP POLICY "Org admins can manage org integration secret refs" ON public.integration_secret_refs;
CREATE POLICY "Org admins can manage org integration secret refs"
  ON public.integration_secret_refs FOR ALL TO authenticated
  USING (
    target_owner_type = 'organization'
    AND EXISTS (
      SELECT 1 FROM org_members m
      WHERE m.org_id = integration_secret_refs.target_org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.role = ANY (ARRAY['owner', 'admin'])
    )
  )
  WITH CHECK (
    target_owner_type = 'organization'
    AND EXISTS (
      SELECT 1 FROM org_members m
      WHERE m.org_id = integration_secret_refs.target_org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.role = ANY (ARRAY['owner', 'admin'])
    )
  );

DROP POLICY "Users can manage own integration secret refs" ON public.integration_secret_refs;
CREATE POLICY "Users can manage own integration secret refs"
  ON public.integration_secret_refs FOR ALL TO authenticated
  USING (target_owner_type = 'user' AND target_user_id = (SELECT auth.uid()))
  WITH CHECK (target_owner_type = 'user' AND target_user_id = (SELECT auth.uid()));

-- 4. legacy_route_usage_events
DROP POLICY "Service role full access legacy route usage events" ON public.legacy_route_usage_events;
CREATE POLICY "Service role full access legacy route usage events"
  ON public.legacy_route_usage_events FOR ALL TO public
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- 5. mcp_api_keys
DROP POLICY "Users can create own mcp_api_keys" ON public.mcp_api_keys;
CREATE POLICY "Users can create own mcp_api_keys"
  ON public.mcp_api_keys FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY "Users can delete own mcp_api_keys" ON public.mcp_api_keys;
CREATE POLICY "Users can delete own mcp_api_keys"
  ON public.mcp_api_keys FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY "Users can update own mcp_api_keys" ON public.mcp_api_keys;
CREATE POLICY "Users can update own mcp_api_keys"
  ON public.mcp_api_keys FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY "Users can view own mcp_api_keys" ON public.mcp_api_keys;
CREATE POLICY "Users can view own mcp_api_keys"
  ON public.mcp_api_keys FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- 6. org_audit_logs
DROP POLICY "Org members can read org audit logs" ON public.org_audit_logs;
CREATE POLICY "Org members can read org audit logs"
  ON public.org_audit_logs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM org_members m
      WHERE m.org_id = org_audit_logs.org_id
        AND m.user_id = (SELECT auth.uid())
    )
  );

-- 7. org_invites
DROP POLICY "Admins can create org invites" ON public.org_invites;
CREATE POLICY "Admins can create org invites"
  ON public.org_invites FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (
      SELECT org_members.org_id FROM org_members
      WHERE org_members.user_id = (SELECT auth.uid())
        AND org_members.role = ANY (ARRAY['owner', 'admin'])
    )
  );

DROP POLICY "Admins can delete org invites" ON public.org_invites;
CREATE POLICY "Admins can delete org invites"
  ON public.org_invites FOR DELETE TO authenticated
  USING (
    org_id IN (
      SELECT org_members.org_id FROM org_members
      WHERE org_members.user_id = (SELECT auth.uid())
        AND org_members.role = ANY (ARRAY['owner', 'admin'])
    )
  );

DROP POLICY "Admins can view org invites" ON public.org_invites;
CREATE POLICY "Admins can view org invites"
  ON public.org_invites FOR SELECT TO authenticated
  USING (
    org_id IN (
      SELECT org_members.org_id FROM org_members
      WHERE org_members.user_id = (SELECT auth.uid())
        AND org_members.role = ANY (ARRAY['owner', 'admin'])
    )
  );

-- 8. org_members
DROP POLICY "Admins can manage org members" ON public.org_members;
CREATE POLICY "Admins can manage org members"
  ON public.org_members FOR ALL TO authenticated
  USING (is_org_admin((SELECT auth.uid()), org_id));

DROP POLICY "Users can add themselves as owner to their new orgs" ON public.org_members;
CREATE POLICY "Users can add themselves as owner to their new orgs"
  ON public.org_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND role = 'owner'
    AND org_id IN (
      SELECT organizations.id FROM organizations
      WHERE organizations.owner_id = (SELECT auth.uid())
    )
  );

DROP POLICY "Users can view org members" ON public.org_members;
CREATE POLICY "Users can view org members"
  ON public.org_members FOR SELECT TO authenticated
  USING (org_id IN (SELECT get_user_org_ids((SELECT auth.uid()))));

-- 9. organizations
DROP POLICY "Owners can update their organizations" ON public.organizations;
CREATE POLICY "Owners can update their organizations"
  ON public.organizations FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()));

DROP POLICY "Owners can view their own orgs" ON public.organizations;
CREATE POLICY "Owners can view their own orgs"
  ON public.organizations FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));

DROP POLICY "Users can create organizations" ON public.organizations;
CREATE POLICY "Users can create organizations"
  ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));

DROP POLICY "Users can view their organizations" ON public.organizations;
CREATE POLICY "Users can view their organizations"
  ON public.organizations FOR SELECT TO authenticated
  USING (id IN (SELECT get_user_org_ids((SELECT auth.uid()))));

-- 10. sdk_embedding_meter_events
DROP POLICY "Service role full access sdk_embedding_meter_events" ON public.sdk_embedding_meter_events;
CREATE POLICY "Service role full access sdk_embedding_meter_events"
  ON public.sdk_embedding_meter_events FOR ALL TO public
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- 11. users
DROP POLICY "Org members can view teammate profiles" ON public.users;
CREATE POLICY "Org members can view teammate profiles"
  ON public.users FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT om.user_id FROM org_members om
      WHERE om.org_id IN (SELECT get_user_org_ids((SELECT auth.uid())))
    )
  );

DROP POLICY "Users can read own row" ON public.users;
CREATE POLICY "Users can read own row"
  ON public.users FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = id);

DROP POLICY "Users can update own row" ON public.users;
CREATE POLICY "Users can update own row"
  ON public.users FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);
;
