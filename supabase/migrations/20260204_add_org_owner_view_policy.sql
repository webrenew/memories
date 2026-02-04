-- Allow org owners to view their organizations immediately after creation
-- This fixes the chicken-and-egg problem where:
-- 1. User creates org (INSERT succeeds: owner_id = auth.uid())
-- 2. .select() after INSERT fails because existing SELECT policy requires user to be in org_members
-- 3. But user isn't in org_members yet!
--
-- This policy allows the owner to SELECT their org before being added as a member.

CREATE POLICY "Owners can view their own orgs"
ON organizations
FOR SELECT
USING (owner_id = auth.uid());
