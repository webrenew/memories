
-- Consolidate multiple permissive policies into single policies per role+action
-- This eliminates the multiple_permissive_policies warnings

-- 1. github_account_links: merge SELECT policies
--    "Users can upsert own github account link" (ALL) already covers SELECT
--    "Users can view own github account link" (SELECT) is redundant
DROP POLICY "Users can view own github account link" ON public.github_account_links;

-- 2. github_capture_settings: merge user + org admin policies into one
DROP POLICY "Org admins can manage org github capture settings" ON public.github_capture_settings;
DROP POLICY "Users can manage own github capture settings" ON public.github_capture_settings;
CREATE POLICY "Authenticated users can manage own or org github capture settings"
  ON public.github_capture_settings FOR ALL TO authenticated
  USING (
    (target_owner_type = 'user' AND target_user_id = (SELECT auth.uid()))
    OR
    (target_owner_type = 'organization' AND EXISTS (
      SELECT 1 FROM org_members m
      WHERE m.org_id = github_capture_settings.target_org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.role = ANY (ARRAY['owner', 'admin'])
    ))
  )
  WITH CHECK (
    (target_owner_type = 'user' AND target_user_id = (SELECT auth.uid()))
    OR
    (target_owner_type = 'organization' AND EXISTS (
      SELECT 1 FROM org_members m
      WHERE m.org_id = github_capture_settings.target_org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.role = ANY (ARRAY['owner', 'admin'])
    ))
  );

-- 3. integration_secret_refs: merge user + org admin policies into one
DROP POLICY "Org admins can manage org integration secret refs" ON public.integration_secret_refs;
DROP POLICY "Users can manage own integration secret refs" ON public.integration_secret_refs;
CREATE POLICY "Authenticated users can manage own or org integration secret refs"
  ON public.integration_secret_refs FOR ALL TO authenticated
  USING (
    (target_owner_type = 'user' AND target_user_id = (SELECT auth.uid()))
    OR
    (target_owner_type = 'organization' AND EXISTS (
      SELECT 1 FROM org_members m
      WHERE m.org_id = integration_secret_refs.target_org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.role = ANY (ARRAY['owner', 'admin'])
    ))
  )
  WITH CHECK (
    (target_owner_type = 'user' AND target_user_id = (SELECT auth.uid()))
    OR
    (target_owner_type = 'organization' AND EXISTS (
      SELECT 1 FROM org_members m
      WHERE m.org_id = integration_secret_refs.target_org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.role = ANY (ARRAY['owner', 'admin'])
    ))
  );

-- 4. org_members: merge admin + self-insert policies for INSERT, and admin + view for SELECT
DROP POLICY "Admins can manage org members" ON public.org_members;
DROP POLICY "Users can add themselves as owner to their new orgs" ON public.org_members;
DROP POLICY "Users can view org members" ON public.org_members;

-- Single SELECT policy
CREATE POLICY "Users can view org members"
  ON public.org_members FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT get_user_org_ids((SELECT auth.uid())))
    OR is_org_admin((SELECT auth.uid()), org_id)
  );

-- Single INSERT policy
CREATE POLICY "Users can insert org members"
  ON public.org_members FOR INSERT TO authenticated
  WITH CHECK (
    is_org_admin((SELECT auth.uid()), org_id)
    OR (
      user_id = (SELECT auth.uid())
      AND role = 'owner'
      AND org_id IN (SELECT id FROM organizations WHERE owner_id = (SELECT auth.uid()))
    )
  );

-- UPDATE/DELETE only for admins
CREATE POLICY "Admins can update org members"
  ON public.org_members FOR UPDATE TO authenticated
  USING (is_org_admin((SELECT auth.uid()), org_id));

CREATE POLICY "Admins can delete org members"
  ON public.org_members FOR DELETE TO authenticated
  USING (is_org_admin((SELECT auth.uid()), org_id));

-- 5. organizations: merge two SELECT policies
DROP POLICY "Owners can view their own orgs" ON public.organizations;
DROP POLICY "Users can view their organizations" ON public.organizations;
CREATE POLICY "Users can view their organizations"
  ON public.organizations FOR SELECT TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    OR id IN (SELECT get_user_org_ids((SELECT auth.uid())))
  );

-- 6. users: merge two SELECT policies
DROP POLICY "Org members can view teammate profiles" ON public.users;
DROP POLICY "Users can read own row" ON public.users;
CREATE POLICY "Users can read own or teammate profiles"
  ON public.users FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) = id
    OR id IN (
      SELECT om.user_id FROM org_members om
      WHERE om.org_id IN (SELECT get_user_org_ids((SELECT auth.uid())))
    )
  );
;
