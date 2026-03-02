
-- workspace_switch_events: analytics/telemetry table
-- Matches pattern of workspace_switch_profile_events (service_role only)
CREATE POLICY "Service role full access workspace_switch_events"
  ON public.workspace_switch_events
  FOR ALL
  TO service_role
  USING (true);
;
