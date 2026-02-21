-- Support multiple active API keys per user for MCP + SDK access.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.mcp_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  api_key_hash TEXT NOT NULL,
  api_key_prefix TEXT NOT NULL,
  api_key_last4 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_via TEXT NOT NULL DEFAULT 'dashboard',
  CONSTRAINT mcp_api_keys_hash_non_empty CHECK (char_length(trim(api_key_hash)) > 0),
  CONSTRAINT mcp_api_keys_prefix_non_empty CHECK (char_length(trim(api_key_prefix)) > 0),
  CONSTRAINT mcp_api_keys_last4_non_empty CHECK (char_length(trim(api_key_last4)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_api_keys_hash_unique
  ON public.mcp_api_keys (api_key_hash);

CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_user_id_active
  ON public.mcp_api_keys (user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_expires_at
  ON public.mcp_api_keys (expires_at);

-- Backfill any existing primary user key metadata so old keys continue to work.
INSERT INTO public.mcp_api_keys (
  user_id,
  api_key_hash,
  api_key_prefix,
  api_key_last4,
  created_at,
  expires_at,
  created_via
)
SELECT
  u.id,
  u.mcp_api_key_hash,
  COALESCE(u.mcp_api_key_prefix, left('mem_legacy', 12)),
  COALESCE(u.mcp_api_key_last4, right(u.mcp_api_key_hash, 4)),
  COALESCE(u.mcp_api_key_created_at, now()),
  COALESCE(u.mcp_api_key_expires_at, now() + INTERVAL '365 days'),
  'legacy-backfill'
FROM public.users AS u
WHERE u.mcp_api_key_hash IS NOT NULL
ON CONFLICT (api_key_hash) DO NOTHING;
