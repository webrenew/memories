-- Add deterministic mapping source semantics for tenant routing.
-- "auto" = runtime auto-provisioning at first use.
-- "override" = explicitly managed override configuration.

ALTER TABLE public.sdk_tenant_databases
  ADD COLUMN IF NOT EXISTS mapping_source TEXT;

UPDATE public.sdk_tenant_databases
SET mapping_source = CASE
  WHEN metadata ->> 'provisionedBy' = 'sdk_auto' THEN 'auto'
  ELSE 'override'
END
WHERE mapping_source IS NULL;

ALTER TABLE public.sdk_tenant_databases
  ALTER COLUMN mapping_source SET DEFAULT 'override';

ALTER TABLE public.sdk_tenant_databases
  ALTER COLUMN mapping_source SET NOT NULL;

ALTER TABLE public.sdk_tenant_databases
  DROP CONSTRAINT IF EXISTS sdk_tenant_databases_mapping_source_check;

ALTER TABLE public.sdk_tenant_databases
  ADD CONSTRAINT sdk_tenant_databases_mapping_source_check
  CHECK (mapping_source IN ('auto', 'override'));

CREATE INDEX IF NOT EXISTS idx_sdk_tenant_databases_mapping_source
  ON public.sdk_tenant_databases (mapping_source);
