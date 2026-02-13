-- Expand GitHub capture depth for release-note ingestion and richer queue filtering.

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT c.conname
    INTO constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'github_capture_queue'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%source_event%'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.github_capture_queue DROP CONSTRAINT %I', constraint_name);
  END IF;
END
$$;

ALTER TABLE public.github_capture_queue
  ADD CONSTRAINT github_capture_queue_source_event_check
  CHECK (source_event IN ('pull_request', 'issues', 'push', 'release'));

CREATE INDEX IF NOT EXISTS idx_github_capture_queue_source_event_created_at
  ON public.github_capture_queue (source_event, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_github_capture_queue_repo_created_at
  ON public.github_capture_queue (repo_full_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_github_capture_queue_actor_created_at
  ON public.github_capture_queue (actor_login, created_at DESC)
  WHERE actor_login IS NOT NULL;
