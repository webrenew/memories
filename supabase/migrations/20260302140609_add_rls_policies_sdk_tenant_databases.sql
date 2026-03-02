
-- sdk_tenant_databases: service-level table, service_role only access
-- Matches pattern of sdk_project_meter_events and sdk_embedding_meter_events
CREATE POLICY "Service role full access sdk_tenant_databases"
  ON public.sdk_tenant_databases
  FOR ALL
  TO service_role
  USING (true);
;
