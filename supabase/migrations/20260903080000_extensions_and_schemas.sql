-- Migration: extensions_and_schemas
-- Apply: creates shared extensions, schemas, roles, and helpers
-- Rollback/recovery: DROP SCHEMA IF EXISTS ... CASCADE (destroys data — restore from backup first)

-- gen_random_uuid() is available without pgcrypto on modern Postgres / PGlite.
-- Phone numbers use text (E.164) rather than citext for portability.

CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS security;
CREATE SCHEMA IF NOT EXISTS finance;

COMMENT ON SCHEMA app IS 'RLS-protected application tables exposed via Data API';
COMMENT ON SCHEMA private IS 'Internal operational data — service role / API only';
COMMENT ON SCHEMA security IS 'Auth, OTP, devices, audit, exports — service role / API only';
COMMENT ON SCHEMA finance IS 'Financial ledgers reserved for later milestones — service role only';

-- Application DB roles (PGlite/local + hosted mapping)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bombee_anon') THEN
    CREATE ROLE bombee_anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bombee_authenticated') THEN
    CREATE ROLE bombee_authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bombee_service') THEN
    CREATE ROLE bombee_service NOLOGIN BYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA app TO bombee_anon, bombee_authenticated, bombee_service;
GRANT USAGE ON SCHEMA private TO bombee_service;
GRANT USAGE ON SCHEMA security TO bombee_service;
GRANT USAGE ON SCHEMA finance TO bombee_service;

-- Default privileges: no blanket grants — explicit per table in later migrations
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA security REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA finance REVOKE ALL ON TABLES FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.current_utc()
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  SELECT timezone('utc', now());
$$;

COMMENT ON FUNCTION app.current_utc IS 'Canonical UTC clock for BomBee';
