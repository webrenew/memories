-- GitHub capture pipeline: account identity links + review queue for PR/issue/commit ingestion.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.github_account_links (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  github_login TEXT NOT NULL,
  github_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT github_account_links_login_format
    CHECK (github_login ~ '^[a-z0-9](?:[a-z0-9-]{0,38})$')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_github_account_links_login_unique
  ON public.github_account_links (lower(github_login));

CREATE TABLE IF NOT EXISTS public.github_capture_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_owner_type TEXT NOT NULL CHECK (target_owner_type IN ('user', 'organization')),
  target_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  target_org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  source_event TEXT NOT NULL CHECK (source_event IN ('pull_request', 'issues', 'push')),
  source_action TEXT,
  repo_full_name TEXT NOT NULL,
  project_id TEXT NOT NULL,
  actor_login TEXT,
  source_id TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  source_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedup_key TEXT NOT NULL,
  reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  decision_note TEXT,
  approved_memory_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT github_capture_queue_target_workspace_check CHECK (
    (target_owner_type = 'user' AND target_user_id IS NOT NULL AND target_org_id IS NULL)
    OR
    (target_owner_type = 'organization' AND target_org_id IS NOT NULL AND target_user_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_github_capture_queue_dedup_key_unique
  ON public.github_capture_queue (dedup_key);

CREATE INDEX IF NOT EXISTS idx_github_capture_queue_status_created_at
  ON public.github_capture_queue (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_github_capture_queue_target_user_status
  ON public.github_capture_queue (target_user_id, status, created_at DESC)
  WHERE target_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_github_capture_queue_target_org_status
  ON public.github_capture_queue (target_org_id, status, created_at DESC)
  WHERE target_org_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'handle_updated_at') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_github_account_links_updated') THEN
      CREATE TRIGGER on_github_account_links_updated
        BEFORE UPDATE ON public.github_account_links
        FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_github_capture_queue_updated') THEN
      CREATE TRIGGER on_github_capture_queue_updated
        BEFORE UPDATE ON public.github_capture_queue
        FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
    END IF;
  END IF;
END
$$;

ALTER TABLE public.github_account_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_capture_queue ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'github_account_links'
      AND policyname = 'Users can view own github account link'
  ) THEN
    CREATE POLICY "Users can view own github account link"
      ON public.github_account_links FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'github_account_links'
      AND policyname = 'Users can upsert own github account link'
  ) THEN
    CREATE POLICY "Users can upsert own github account link"
      ON public.github_account_links FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'github_account_links'
      AND policyname = 'Service role full access github account links'
  ) THEN
    CREATE POLICY "Service role full access github account links"
      ON public.github_account_links FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'github_capture_queue'
      AND policyname = 'Service role full access github capture queue'
  ) THEN
    CREATE POLICY "Service role full access github capture queue"
      ON public.github_capture_queue FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$$;
