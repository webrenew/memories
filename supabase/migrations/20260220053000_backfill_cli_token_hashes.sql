-- Enforce hashed-only CLI auth by migrating any remaining plaintext tokens.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE public.users
SET cli_token_hash = COALESCE(
  cli_token_hash,
  encode(extensions.digest(convert_to(cli_token, 'UTF8'), 'sha256'), 'hex')
)
WHERE cli_token IS NOT NULL;

UPDATE public.users
SET cli_token = NULL
WHERE cli_token IS NOT NULL
  AND cli_token_hash IS NOT NULL;
