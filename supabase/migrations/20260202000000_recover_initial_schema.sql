-- Recover the four original tables absent from the recorded migration history.
-- Definitions were exported from production on 2026-10-22. Existing tables,
-- functions, indexes, constraints, policies, ownership and data are untouched.
-- Fresh tables remain private until the catalog-generated grants baseline.
do $initial_schema$
declare
  create_users boolean := to_regclass('public.users') is null;
  create_organizations boolean := to_regclass('public.organizations') is null;
  create_org_members boolean := to_regclass('public.org_members') is null;
  create_org_invites boolean := to_regclass('public.org_invites') is null;
begin
  if create_users then
CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL PRIMARY KEY,
    "email" "text" NOT NULL,
    "name" "text",
    "avatar_url" "text",
    "plan" "text" DEFAULT 'free'::"text" NOT NULL,
    "stripe_customer_id" "text",
    "turso_db_url" "text",
    "turso_db_token" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cli_token" "text",
    "cli_auth_code" "text",
    "turso_db_name" "text",
    "mcp_api_key" "text",
    "current_org_id" "uuid",
    "embedding_model" "text" DEFAULT 'all-MiniLM-L6-v2'::"text",
    "mcp_api_key_hash" "text",
    "mcp_api_key_prefix" "text",
    "mcp_api_key_last4" "text",
    "mcp_api_key_created_at" timestamp with time zone,
    "mcp_api_key_expires_at" timestamp with time zone,
    "repo_workspace_routing_mode" "text" DEFAULT 'auto'::"text" NOT NULL,
    "repo_owner_org_mappings" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "cli_token_hash" "text",
    "cli_auth_expires_at" timestamp with time zone,
    CONSTRAINT "users_mcp_api_key_metadata_required" CHECK ((("mcp_api_key_hash" IS NULL) OR (("mcp_api_key_prefix" IS NOT NULL) AND ("mcp_api_key_last4" IS NOT NULL) AND ("mcp_api_key_created_at" IS NOT NULL) AND ("mcp_api_key_expires_at" IS NOT NULL)))),
    CONSTRAINT "users_plan_check" CHECK (("plan" = ANY (ARRAY['free'::"text", 'pro'::"text", 'individual'::"text", 'team'::"text", 'growth'::"text", 'enterprise'::"text", 'past_due'::"text"]))),
    CONSTRAINT "users_repo_owner_org_mappings_is_array" CHECK (("jsonb_typeof"("repo_owner_org_mappings") = 'array'::"text")),
    CONSTRAINT "users_repo_workspace_routing_mode_check" CHECK (("repo_workspace_routing_mode" = ANY (ARRAY['auto'::"text", 'active_workspace'::"text"])))
);
alter table public."users" enable row level security;
revoke all on table public."users" from PUBLIC, anon, authenticated, service_role;
  end if;
  if create_organizations then
CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "plan" "text" DEFAULT 'team'::"text" NOT NULL,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "subscription_status" "text" DEFAULT 'active'::"text",
    "turso_db_url" "text",
    "turso_db_token" "text",
    "turso_db_name" "text",
    "domain_auto_join_enabled" boolean DEFAULT false NOT NULL,
    "domain_auto_join_domain" "text",
    CONSTRAINT "organizations_domain_auto_join_domain_format" CHECK ((("domain_auto_join_domain" IS NULL) OR ("domain_auto_join_domain" ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'::"text"))),
    CONSTRAINT "organizations_plan_check" CHECK (("plan" = ANY (ARRAY['free'::"text", 'pro'::"text", 'individual'::"text", 'team'::"text", 'growth'::"text", 'enterprise'::"text", 'past_due'::"text"]))),
    CONSTRAINT "organizations_subscription_status_check" CHECK (("subscription_status" = ANY (ARRAY['active'::"text", 'past_due'::"text", 'cancelled'::"text"])))
);
alter table public."organizations" enable row level security;
revoke all on table public."organizations" from PUBLIC, anon, authenticated, service_role;
  end if;
  if create_org_members then
CREATE TABLE IF NOT EXISTS "public"."org_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "invited_by" "uuid",
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "org_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'member'::"text"])))
);
alter table public."org_members" enable row level security;
revoke all on table public."org_members" from PUBLIC, anon, authenticated, service_role;
  end if;
  if create_org_invites then
CREATE TABLE IF NOT EXISTS "public"."org_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "org_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "invited_by" "uuid" NOT NULL,
    "token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(32), 'hex'::"text") NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval) NOT NULL,
    "accepted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "org_invites_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'member'::"text"])))
);
alter table public."org_invites" enable row level security;
revoke all on table public."org_invites" from PUBLIC, anon, authenticated, service_role;
  end if;
  if to_regprocedure('public.get_user_org_ids(uuid)') is null and to_regprocedure('private.get_user_org_ids(uuid)') is null then
CREATE OR REPLACE FUNCTION "public"."get_user_org_ids"("uid" "uuid") RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT org_id FROM org_members WHERE user_id = uid;
$$;
  end if;
  if to_regprocedure('public.is_org_admin(uuid,uuid)') is null and to_regprocedure('private.is_org_admin(uuid,uuid)') is null then
CREATE OR REPLACE FUNCTION "public"."is_org_admin"("uid" "uuid", "oid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members 
    WHERE user_id = uid 
      AND org_id = oid 
      AND role IN ('owner', 'admin')
  );
$$;
  end if;
  if to_regprocedure('public.handle_new_user()') is null then
CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.users (id, email, name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name'),
    COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', NEW.raw_user_meta_data ->> 'picture')
  );
  RETURN NEW;
END;
$$;
  end if;
  if to_regprocedure('public.handle_updated_at()') is null then
CREATE OR REPLACE FUNCTION "public"."handle_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
  end if;
  if create_users then
CREATE POLICY "Org members can view teammate profiles" ON public.users FOR SELECT TO authenticated
  USING (id IN (SELECT user_id FROM public.org_members WHERE org_id IN (SELECT public.get_user_org_ids((SELECT auth.uid())))));
CREATE POLICY "Users can read own row" ON public.users FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = id);
ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_cli_token_key" UNIQUE ("cli_token");
ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_mcp_api_key_key" UNIQUE ("mcp_api_key");
ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_stripe_customer_id_key" UNIQUE ("stripe_customer_id");
CREATE UNIQUE INDEX "idx_users_cli_token_hash" ON "public"."users" USING "btree" ("cli_token_hash") WHERE ("cli_token_hash" IS NOT NULL);
CREATE INDEX "idx_users_current_org_id" ON "public"."users" USING "btree" ("current_org_id");
CREATE UNIQUE INDEX "idx_users_mcp_api_key_hash_unique" ON "public"."users" USING "btree" ("mcp_api_key_hash") WHERE ("mcp_api_key_hash" IS NOT NULL);
CREATE OR REPLACE TRIGGER "on_users_updated" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();
CREATE TRIGGER "on_auth_user_created" AFTER INSERT ON "auth"."users"
  FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();
ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_current_org_id_fkey" FOREIGN KEY ("current_org_id") REFERENCES "public"."organizations"("id");
ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
CREATE POLICY "Service role full access" ON "public"."users" TO "service_role" USING (true);
CREATE POLICY "Users can update own row" ON "public"."users" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "id"));
  end if;
  if create_organizations then
CREATE POLICY "Owners can view their own orgs" ON public.organizations FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));
ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_slug_key" UNIQUE ("slug");
CREATE UNIQUE INDEX "idx_organizations_domain_auto_join_domain_unique" ON "public"."organizations" USING "btree" ("lower"("domain_auto_join_domain")) WHERE (("domain_auto_join_enabled" = true) AND ("domain_auto_join_domain" IS NOT NULL));
CREATE INDEX "idx_organizations_owner_id" ON "public"."organizations" USING "btree" ("owner_id");
CREATE INDEX "idx_organizations_slug" ON "public"."organizations" USING "btree" ("slug");
CREATE UNIQUE INDEX "idx_organizations_stripe_customer_id_unique" ON "public"."organizations" USING "btree" ("stripe_customer_id") WHERE ("stripe_customer_id" IS NOT NULL);
CREATE UNIQUE INDEX "idx_organizations_turso_db_name_unique" ON "public"."organizations" USING "btree" ("turso_db_name") WHERE ("turso_db_name" IS NOT NULL);
ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
CREATE POLICY "Owners can update their organizations" ON "public"."organizations" FOR UPDATE TO "authenticated" USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));
CREATE POLICY "Users can create organizations" ON "public"."organizations" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));
CREATE POLICY "Users can view their organizations" ON "public"."organizations" FOR SELECT TO "authenticated" USING ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("id" IN ( SELECT "public"."get_user_org_ids"(( SELECT "auth"."uid"() AS "uid")) AS "get_user_org_ids"))));
  end if;
  if create_org_members then
CREATE POLICY "Admins can manage org members" ON public.org_members FOR ALL TO authenticated
  USING (public.is_org_admin((SELECT auth.uid()), org_id));
ALTER TABLE ONLY "public"."org_members"
    ADD CONSTRAINT "org_members_org_id_user_id_key" UNIQUE ("org_id", "user_id");
CREATE INDEX "idx_org_members_invited_by" ON "public"."org_members" USING "btree" ("invited_by");
CREATE INDEX "idx_org_members_org" ON "public"."org_members" USING "btree" ("org_id");
CREATE INDEX "idx_org_members_user" ON "public"."org_members" USING "btree" ("user_id");
ALTER TABLE ONLY "public"."org_members"
    ADD CONSTRAINT "org_members_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id");
ALTER TABLE ONLY "public"."org_members"
    ADD CONSTRAINT "org_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."org_members"
    ADD CONSTRAINT "org_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
CREATE POLICY "Users can view org members" ON "public"."org_members" FOR SELECT TO "authenticated" USING ((("org_id" IN ( SELECT "public"."get_user_org_ids"(( SELECT "auth"."uid"() AS "uid")) AS "get_user_org_ids")) OR "public"."is_org_admin"(( SELECT "auth"."uid"() AS "uid"), "org_id")));
  end if;
  if create_org_invites then
ALTER TABLE ONLY "public"."org_invites"
    ADD CONSTRAINT "org_invites_org_id_email_key" UNIQUE ("org_id", "email");
ALTER TABLE ONLY "public"."org_invites"
    ADD CONSTRAINT "org_invites_token_key" UNIQUE ("token");
CREATE INDEX "idx_org_invites_invited_by" ON "public"."org_invites" USING "btree" ("invited_by");
CREATE INDEX "idx_org_invites_org" ON "public"."org_invites" USING "btree" ("org_id");
CREATE UNIQUE INDEX "idx_org_invites_pending_org_email_unique" ON "public"."org_invites" USING "btree" ("org_id", "lower"("email")) WHERE ("accepted_at" IS NULL);
CREATE INDEX "idx_org_invites_token" ON "public"."org_invites" USING "btree" ("token");
ALTER TABLE ONLY "public"."org_invites"
    ADD CONSTRAINT "org_invites_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id");
ALTER TABLE ONLY "public"."org_invites"
    ADD CONSTRAINT "org_invites_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
CREATE POLICY "Admins can create org invites" ON "public"."org_invites" FOR INSERT TO "authenticated" WITH CHECK (("org_id" IN ( SELECT "org_members"."org_id"
   FROM "public"."org_members"
  WHERE (("org_members"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("org_members"."role" = ANY (ARRAY['owner'::"text", 'admin'::"text"]))))));
CREATE POLICY "Admins can delete org invites" ON "public"."org_invites" FOR DELETE TO "authenticated" USING (("org_id" IN ( SELECT "org_members"."org_id"
   FROM "public"."org_members"
  WHERE (("org_members"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("org_members"."role" = ANY (ARRAY['owner'::"text", 'admin'::"text"]))))));
CREATE POLICY "Admins can view org invites" ON "public"."org_invites" FOR SELECT TO "authenticated" USING (("org_id" IN ( SELECT "org_members"."org_id"
   FROM "public"."org_members"
  WHERE (("org_members"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("org_members"."role" = ANY (ARRAY['owner'::"text", 'admin'::"text"]))))));
  end if;
end;
$initial_schema$;
