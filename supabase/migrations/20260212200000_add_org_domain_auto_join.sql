-- Organization-level domain auto-join settings.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS domain_auto_join_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS domain_auto_join_domain TEXT;

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_domain_auto_join_domain_format;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_domain_auto_join_domain_format
  CHECK (
    domain_auto_join_domain IS NULL
    OR domain_auto_join_domain ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_domain_auto_join_domain_unique
  ON public.organizations (lower(domain_auto_join_domain))
  WHERE domain_auto_join_enabled = TRUE AND domain_auto_join_domain IS NOT NULL;
