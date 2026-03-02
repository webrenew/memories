-- Atomic helpers for org member removal, org settings updates, and org deletion.

DO $remove_member$
BEGIN
  EXECUTE $create_fn$
    CREATE OR REPLACE FUNCTION public.remove_org_member_atomic(
      p_org_id UUID,
      p_actor_user_id UUID,
      p_target_user_id UUID
    ) RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $fn$
    DECLARE
      v_actor_role TEXT;
      v_target_role TEXT;
      v_removed_by_self BOOLEAN;
    BEGIN
      SELECT role
      INTO v_actor_role
      FROM public.org_members
      WHERE org_id = p_org_id
        AND user_id = p_actor_user_id
      FOR UPDATE;

      IF v_actor_role IS NULL THEN
        RETURN jsonb_build_object('status', 'actor_not_member');
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

      v_removed_by_self := p_target_user_id = p_actor_user_id;
      IF NOT v_removed_by_self AND v_actor_role NOT IN ('owner', 'admin') THEN
        RETURN jsonb_build_object('status', 'insufficient_permissions');
      END IF;

      DELETE FROM public.org_members
      WHERE org_id = p_org_id
        AND user_id = p_target_user_id;

      IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'target_not_member');
      END IF;

      RETURN jsonb_build_object(
        'status', 'removed',
        'removed_role', v_target_role,
        'removed_by_self', v_removed_by_self
      );
    END;
    $fn$;
  $create_fn$;

  EXECUTE 'ALTER FUNCTION public.remove_org_member_atomic(UUID, UUID, UUID) SET search_path = public';
  EXECUTE 'REVOKE ALL ON FUNCTION public.remove_org_member_atomic(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.remove_org_member_atomic(UUID, UUID, UUID) TO service_role';
END
$remove_member$;

DO $update_org_settings$
BEGIN
  EXECUTE $create_fn$
    CREATE OR REPLACE FUNCTION public.update_org_settings_atomic(
      p_org_id UUID,
      p_actor_user_id UUID,
      p_name TEXT,
      p_set_name BOOLEAN,
      p_domain_auto_join_enabled BOOLEAN,
      p_set_domain_auto_join_enabled BOOLEAN,
      p_domain_auto_join_domain TEXT,
      p_set_domain_auto_join_domain BOOLEAN
    ) RETURNS TEXT
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $fn$
    DECLARE
      v_actor_role TEXT;
      v_org public.organizations%ROWTYPE;
      v_next_name TEXT;
      v_next_domain_auto_join_enabled BOOLEAN;
      v_next_domain_auto_join_domain TEXT;
      v_domain_changed BOOLEAN;
      v_supports_domain_auto_join BOOLEAN;
    BEGIN
      SELECT role
      INTO v_actor_role
      FROM public.org_members
      WHERE org_id = p_org_id
        AND user_id = p_actor_user_id
      FOR UPDATE;

      IF v_actor_role IS NULL OR v_actor_role NOT IN ('owner', 'admin') THEN
        RETURN 'insufficient_permissions';
      END IF;

      IF (p_set_domain_auto_join_enabled OR p_set_domain_auto_join_domain) AND v_actor_role <> 'owner' THEN
        RETURN 'owner_required';
      END IF;

      SELECT *
      INTO v_org
      FROM public.organizations
      WHERE id = p_org_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RETURN 'org_not_found';
      END IF;

      v_next_name := v_org.name;
      v_next_domain_auto_join_enabled := COALESCE(v_org.domain_auto_join_enabled, FALSE);
      v_next_domain_auto_join_domain := v_org.domain_auto_join_domain;

      IF p_set_name THEN
        v_next_name := p_name;
      END IF;

      IF p_set_domain_auto_join_domain THEN
        v_next_domain_auto_join_domain := p_domain_auto_join_domain;
      END IF;

      IF p_set_domain_auto_join_enabled THEN
        v_next_domain_auto_join_enabled := p_domain_auto_join_enabled;
      END IF;

      v_domain_changed := COALESCE(v_next_domain_auto_join_domain, '') <> COALESCE(v_org.domain_auto_join_domain, '');
      IF v_domain_changed AND v_next_domain_auto_join_domain IS NOT NULL AND char_length(trim(v_next_domain_auto_join_domain)) > 0 THEN
        v_next_domain_auto_join_enabled := TRUE;
      END IF;
      IF v_domain_changed AND v_next_domain_auto_join_domain IS NULL THEN
        v_next_domain_auto_join_enabled := FALSE;
      END IF;

      IF v_next_domain_auto_join_enabled AND (v_next_domain_auto_join_domain IS NULL OR char_length(trim(v_next_domain_auto_join_domain)) = 0) THEN
        RETURN 'domain_required';
      END IF;

      IF v_next_domain_auto_join_enabled THEN
        v_supports_domain_auto_join := FALSE;

        IF v_org.subscription_status = 'active' THEN
          IF v_org.plan IN ('team', 'growth') THEN
            v_supports_domain_auto_join := TRUE;
          ELSIF v_org.plan IS NULL AND v_org.stripe_subscription_id IS NOT NULL THEN
            v_supports_domain_auto_join := TRUE;
          END IF;
        ELSIF v_org.subscription_status IS NULL THEN
          IF v_org.plan IN ('team', 'growth') THEN
            v_supports_domain_auto_join := TRUE;
          END IF;
        END IF;

        IF NOT v_supports_domain_auto_join THEN
          RETURN 'team_plan_required';
        END IF;
      END IF;

      UPDATE public.organizations
      SET
        name = v_next_name,
        domain_auto_join_enabled = v_next_domain_auto_join_enabled,
        domain_auto_join_domain = v_next_domain_auto_join_domain,
        updated_at = now()
      WHERE id = p_org_id;

      RETURN 'updated';
    END;
    $fn$;
  $create_fn$;

  EXECUTE 'ALTER FUNCTION public.update_org_settings_atomic(UUID, UUID, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, BOOLEAN) SET search_path = public';
  EXECUTE 'REVOKE ALL ON FUNCTION public.update_org_settings_atomic(UUID, UUID, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.update_org_settings_atomic(UUID, UUID, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, BOOLEAN) TO service_role';
END
$update_org_settings$;

DO $delete_org$
BEGIN
  EXECUTE $create_fn$
    CREATE OR REPLACE FUNCTION public.delete_organization_atomic(
      p_org_id UUID,
      p_actor_user_id UUID
    ) RETURNS TEXT
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $fn$
    DECLARE
      v_actor_role TEXT;
    BEGIN
      SELECT role
      INTO v_actor_role
      FROM public.org_members
      WHERE org_id = p_org_id
        AND user_id = p_actor_user_id
      FOR UPDATE;

      IF v_actor_role IS NULL THEN
        RETURN 'actor_not_member';
      END IF;

      IF v_actor_role <> 'owner' THEN
        RETURN 'owner_required';
      END IF;

      DELETE FROM public.organizations
      WHERE id = p_org_id;

      IF NOT FOUND THEN
        RETURN 'org_not_found';
      END IF;

      RETURN 'deleted';
    END;
    $fn$;
  $create_fn$;

  EXECUTE 'ALTER FUNCTION public.delete_organization_atomic(UUID, UUID) SET search_path = public';
  EXECUTE 'REVOKE ALL ON FUNCTION public.delete_organization_atomic(UUID, UUID) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.delete_organization_atomic(UUID, UUID) TO service_role';
END
$delete_org$;
