
-- Enable RLS on mcp_api_keys (currently disabled)
ALTER TABLE public.mcp_api_keys ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Service role full access mcp_api_keys"
  ON public.mcp_api_keys
  FOR ALL
  TO service_role
  USING (true);

-- Users can view their own API keys
CREATE POLICY "Users can view own mcp_api_keys"
  ON public.mcp_api_keys
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can create their own API keys
CREATE POLICY "Users can create own mcp_api_keys"
  ON public.mcp_api_keys
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own API keys (e.g. revoke)
CREATE POLICY "Users can update own mcp_api_keys"
  ON public.mcp_api_keys
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can delete their own API keys
CREATE POLICY "Users can delete own mcp_api_keys"
  ON public.mcp_api_keys
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
;
