-- Token accounting metadata for embedding billing accuracy + discrepancy analysis.

ALTER TABLE public.sdk_embedding_meter_events
  ADD COLUMN IF NOT EXISTS token_count_method TEXT NOT NULL DEFAULT 'char_fallback',
  ADD COLUMN IF NOT EXISTS token_count_fallback_reason TEXT,
  ADD COLUMN IF NOT EXISTS input_tokens_char_estimate INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens_char_estimate >= 0),
  ADD COLUMN IF NOT EXISTS input_tokens_delta INTEGER NOT NULL DEFAULT 0;

UPDATE public.sdk_embedding_meter_events
SET
  token_count_method = COALESCE(NULLIF(token_count_method, ''), 'char_fallback'),
  input_tokens_char_estimate = COALESCE(input_tokens_char_estimate, input_tokens, 0),
  input_tokens_delta = COALESCE(input_tokens_delta, 0)
WHERE token_count_method IS NULL
   OR token_count_method = ''
   OR input_tokens_char_estimate IS NULL
   OR input_tokens_delta IS NULL;

CREATE INDEX IF NOT EXISTS idx_sdk_embedding_meter_events_token_method_month
  ON public.sdk_embedding_meter_events (token_count_method, usage_month);

CREATE INDEX IF NOT EXISTS idx_sdk_embedding_meter_events_token_delta_month
  ON public.sdk_embedding_meter_events (usage_month, input_tokens_delta);
