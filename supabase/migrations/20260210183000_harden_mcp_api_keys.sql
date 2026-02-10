-- Harden MCP API key storage by moving from plaintext keys to hash + metadata.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS mcp_api_key_hash TEXT,
ADD COLUMN IF NOT EXISTS mcp_api_key_prefix TEXT,
ADD COLUMN IF NOT EXISTS mcp_api_key_last4 TEXT,
ADD COLUMN IF NOT EXISTS mcp_api_key_created_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS mcp_api_key_expires_at TIMESTAMPTZ;

-- Backfill existing keys so old deployments keep working through the transition.
UPDATE public.users
SET
  mcp_api_key_hash = COALESCE(mcp_api_key_hash, encode(extensions.digest(convert_to(mcp_api_key, 'UTF8'), 'sha256'), 'hex')),
  mcp_api_key_prefix = COALESCE(mcp_api_key_prefix, left(mcp_api_key, 12)),
  mcp_api_key_last4 = COALESCE(mcp_api_key_last4, right(mcp_api_key, 4)),
  mcp_api_key_created_at = COALESCE(mcp_api_key_created_at, now()),
  mcp_api_key_expires_at = COALESCE(mcp_api_key_expires_at, now() + INTERVAL '365 days')
WHERE mcp_api_key IS NOT NULL;

-- Remove plaintext secrets at rest once hash metadata exists.
UPDATE public.users
SET mcp_api_key = NULL
WHERE mcp_api_key IS NOT NULL
  AND mcp_api_key_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_mcp_api_key_hash_unique
  ON public.users(mcp_api_key_hash)
  WHERE mcp_api_key_hash IS NOT NULL;

DROP INDEX IF EXISTS idx_users_mcp_api_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_mcp_api_key_metadata_required'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_mcp_api_key_metadata_required
      CHECK (
        mcp_api_key_hash IS NULL
        OR (
          mcp_api_key_prefix IS NOT NULL
          AND mcp_api_key_last4 IS NOT NULL
          AND mcp_api_key_created_at IS NOT NULL
          AND mcp_api_key_expires_at IS NOT NULL
        )
      );
  END IF;
END $$;
