-- Atomic helpers for workspace switching + member role updates,
-- plus a lock table to avoid duplicate DB provisioning work.

CREATE TABLE IF NOT EXISTS public.workspace_db_provision_locks (
  owner_key TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('user', 'organization')),
  owner_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  owner_org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  locked_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workspace_db_provision_locks_owner_check CHECK (
    (owner_type = 'user' AND owner_user_id IS NOT NULL AND owner_org_id IS NULL)
    OR
    (owner_type = 'organization' AND owner_org_id IS NOT NULL AND owner_user_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_workspace_db_provision_locks_created_at
  ON public.workspace_db_provision_locks (created_at);

ALTER TABLE public.workspace_db_provision_locks ENABLE ROW LEVEL SECURITY;

DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workspace_db_provision_locks'
      AND policyname = 'Service role full access workspace db provision locks'
  ) THEN
    CREATE POLICY "Service role full access workspace db provision locks"
      ON public.workspace_db_provision_locks FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$policy$;

DO $switch_workspace$
BEGIN
  EXECUTE $create_fn$
    CREATE OR REPLACE FUNCTION public.switch_user_workspace_atomic(
      p_user_id UUID,
      p_next_org_id UUID
    ) RETURNS TEXT
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $fn$
    DECLARE
      v_has_membership BOOLEAN := FALSE;
    BEGIN
      IF p_next_org_id IS NULL THEN
        UPDATE public.users
        SET current_org_id = NULL
        WHERE id = p_user_id;

        IF NOT FOUND THEN
          RETURN 'not_found';
        END IF;

        RETURN 'updated';
      END IF;

      SELECT TRUE
      INTO v_has_membership
      FROM public.org_members
      WHERE org_id = p_next_org_id
        AND user_id = p_user_id
      FOR SHARE;

      IF NOT v_has_membership THEN
        RETURN 'membership_denied';
      END IF;

      UPDATE public.users
      SET current_org_id = p_next_org_id
      WHERE id = p_user_id;

      IF NOT FOUND THEN
        RETURN 'not_found';
      END IF;

      RETURN 'updated';
    END;
    $fn$;
  $create_fn$;

  EXECUTE 'ALTER FUNCTION public.switch_user_workspace_atomic(UUID, UUID) SET search_path = public';
  EXECUTE 'REVOKE ALL ON FUNCTION public.switch_user_workspace_atomic(UUID, UUID) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.switch_user_workspace_atomic(UUID, UUID) TO service_role';
END
$switch_workspace$;

DO $update_member_role$
BEGIN
  EXECUTE $create_fn$
    CREATE OR REPLACE FUNCTION public.update_org_member_role_atomic(
      p_org_id UUID,
      p_actor_user_id UUID,
      p_target_user_id UUID,
      p_next_role TEXT
    ) RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $fn$
    DECLARE
      v_actor_role TEXT;
      v_target_role TEXT;
    BEGIN
      IF p_next_role IS NULL OR p_next_role NOT IN ('admin', 'member') THEN
        RETURN jsonb_build_object('status', 'invalid_role');
      END IF;

      SELECT role
      INTO v_actor_role
      FROM public.org_members
      WHERE org_id = p_org_id
        AND user_id = p_actor_user_id
      FOR UPDATE;

      IF v_actor_role IS NULL OR v_actor_role NOT IN ('owner', 'admin') THEN
        RETURN jsonb_build_object('status', 'insufficient_permissions');
      END IF;

      SELECT role
      INTO v_target_role
      FROM public.org_members
      WHERE org_id = p_org_id
        AND user_id = p_target_user_id
      FOR UPDATE;

      IF v_target_role IS NULL THEN
        RETURN jsonb_build_object('status', 'target_not_member');
      END IF;

      IF v_target_role = 'owner' THEN
        RETURN jsonb_build_object('status', 'target_is_owner');
      END IF;

      IF p_next_role = 'admin' AND v_actor_role <> 'owner' THEN
        RETURN jsonb_build_object('status', 'owner_required');
      END IF;

      IF v_target_role = p_next_role THEN
        RETURN jsonb_build_object(
          'status', 'unchanged',
          'updated', false,
          'previous_role', v_target_role
        );
      END IF;

      UPDATE public.org_members
      SET role = p_next_role
      WHERE org_id = p_org_id
        AND user_id = p_target_user_id;

      RETURN jsonb_build_object(
        'status', 'updated',
        'updated', true,
        'previous_role', v_target_role
      );
    END;
    $fn$;
  $create_fn$;

  EXECUTE 'ALTER FUNCTION public.update_org_member_role_atomic(UUID, UUID, UUID, TEXT) SET search_path = public';
  EXECUTE 'REVOKE ALL ON FUNCTION public.update_org_member_role_atomic(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.update_org_member_role_atomic(UUID, UUID, UUID, TEXT) TO service_role';
END
$update_member_role$;
