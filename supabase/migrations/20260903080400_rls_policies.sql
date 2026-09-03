-- Migration: rls_policies
-- Apply: enable RLS on exposed app schema tables; deny-by-default for anon
-- Rollback/recovery: disable policy carefully after confirming service-role access path

ALTER TABLE app.customer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.staff_profiles ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners in hosted setups that map to these roles
ALTER TABLE app.customer_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE app.staff_profiles FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION app.request_identity_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE POLICY customer_profiles_select_own
  ON app.customer_profiles
  FOR SELECT
  TO bombee_authenticated
  USING (auth_identity_id = app.request_identity_id());

CREATE POLICY customer_profiles_update_own
  ON app.customer_profiles
  FOR UPDATE
  TO bombee_authenticated
  USING (auth_identity_id = app.request_identity_id())
  WITH CHECK (auth_identity_id = app.request_identity_id());

CREATE POLICY customer_profiles_service_all
  ON app.customer_profiles
  FOR ALL
  TO bombee_service
  USING (true)
  WITH CHECK (true);

CREATE POLICY staff_profiles_select_authenticated
  ON app.staff_profiles
  FOR SELECT
  TO bombee_authenticated
  USING (auth_identity_id = app.request_identity_id());

CREATE POLICY staff_profiles_service_all
  ON app.staff_profiles
  FOR ALL
  TO bombee_service
  USING (true)
  WITH CHECK (true);

-- Anon: no direct access to staff; customers only via service in Phase 1 login flows
REVOKE ALL ON app.staff_profiles FROM bombee_anon;
REVOKE INSERT, UPDATE, DELETE ON app.customer_profiles FROM bombee_anon;
