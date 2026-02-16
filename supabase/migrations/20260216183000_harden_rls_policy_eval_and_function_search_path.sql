-- Harden trigger function search_path and optimize RLS policy auth evaluation.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'handle_new_user'
      AND p.pronargs = 0
  ) THEN
    EXECUTE 'ALTER FUNCTION public.handle_new_user() SET search_path = public';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'handle_updated_at'
      AND p.pronargs = 0
  ) THEN
    EXECUTE 'ALTER FUNCTION public.handle_updated_at() SET search_path = public';
  END IF;
END
$$;

DO $$
DECLARE
  rec RECORD;
  stmt TEXT;
BEGIN
  FOR rec IN
    SELECT
      n.nspname AS schemaname,
      c.relname AS tablename,
      p.polname AS policyname,
      (p.polqual IS NOT NULL) AS has_using,
      (p.polwithcheck IS NOT NULL) AS has_with_check
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND p.polname LIKE 'Service role full access%'
  LOOP
    stmt := format('ALTER POLICY %I ON %I.%I TO service_role', rec.policyname, rec.schemaname, rec.tablename);

    IF rec.has_using OR NOT rec.has_with_check THEN
      stmt := stmt || ' USING (true)';
    END IF;

    IF rec.has_with_check THEN
      stmt := stmt || ' WITH CHECK (true)';
    END IF;

    EXECUTE stmt;
  END LOOP;
END
$$;

DO $$
DECLARE
  rec RECORD;
  stmt TEXT;
  new_qual TEXT;
  new_check TEXT;
  should_scope_authenticated BOOLEAN;
BEGIN
  FOR rec IN
    SELECT
      n.nspname AS schemaname,
      c.relname AS tablename,
      p.polname AS policyname,
      pg_get_expr(p.polqual, p.polrelid) AS qual_expr,
      pg_get_expr(p.polwithcheck, p.polrelid) AS with_check_expr,
      (
        coalesce(array_length(p.polroles, 1), 0) = 1
        AND coalesce(p.polroles[1], 0) = 0
      ) AS is_public_policy
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
  LOOP
    IF rec.qual_expr IS NULL THEN
      new_qual := NULL;
    ELSE
      new_qual := regexp_replace(rec.qual_expr, 'auth\.uid\(\)', '(select auth.uid())', 'g');
      new_qual := regexp_replace(new_qual, 'auth\.role\(\)', '(select auth.role())', 'g');
      new_qual := replace(new_qual, '(select (select auth.uid()))', '(select auth.uid())');
      new_qual := replace(new_qual, '(select (select auth.role()))', '(select auth.role())');
    END IF;

    IF rec.with_check_expr IS NULL THEN
      new_check := NULL;
    ELSE
      new_check := regexp_replace(rec.with_check_expr, 'auth\.uid\(\)', '(select auth.uid())', 'g');
      new_check := regexp_replace(new_check, 'auth\.role\(\)', '(select auth.role())', 'g');
      new_check := replace(new_check, '(select (select auth.uid()))', '(select auth.uid())');
      new_check := replace(new_check, '(select (select auth.role()))', '(select auth.role())');
    END IF;

    should_scope_authenticated :=
      rec.is_public_policy
      AND rec.policyname NOT LIKE 'Service role full access%'
      AND (
        coalesce(rec.qual_expr, '') LIKE '%auth.uid()%'
        OR coalesce(rec.with_check_expr, '') LIKE '%auth.uid()%'
      );

    IF should_scope_authenticated
      OR new_qual IS DISTINCT FROM rec.qual_expr
      OR new_check IS DISTINCT FROM rec.with_check_expr
    THEN
      stmt := format('ALTER POLICY %I ON %I.%I', rec.policyname, rec.schemaname, rec.tablename);

      IF should_scope_authenticated THEN
        stmt := stmt || ' TO authenticated';
      END IF;

      IF rec.qual_expr IS NOT NULL THEN
        stmt := stmt || format(' USING (%s)', new_qual);
      END IF;

      IF rec.with_check_expr IS NOT NULL THEN
        stmt := stmt || format(' WITH CHECK (%s)', new_check);
      END IF;

      EXECUTE stmt;
    END IF;
  END LOOP;
END
$$;
