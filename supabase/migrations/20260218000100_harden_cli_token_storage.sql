ALTER TABLE public.users ADD COLUMN IF NOT EXISTS cli_token_hash TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS cli_auth_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_cli_token_hash
  ON public.users(cli_token_hash)
  WHERE cli_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_cli_auth_expires_at
  ON public.users(cli_auth_expires_at);
