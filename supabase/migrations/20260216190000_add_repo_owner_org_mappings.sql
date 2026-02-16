ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS repo_owner_org_mappings JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_repo_owner_org_mappings_is_array'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_repo_owner_org_mappings_is_array
      CHECK (jsonb_typeof(repo_owner_org_mappings) = 'array');
  END IF;
END $$;
