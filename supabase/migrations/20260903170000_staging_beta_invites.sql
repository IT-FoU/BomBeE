-- Migration: staging_beta_invites
-- Apply: invite-only access for Staging / Private Beta
-- Rollback/recovery: drop invite tables; keep Production Hold until Owner order

CREATE TABLE app.beta_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code text NOT NULL UNIQUE,
  phone_e164 text,
  email text,
  intended_role text NOT NULL DEFAULT 'customer'
    CHECK (intended_role IN ('customer', 'store_owner', 'ops', 'admin')),
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  expires_at timestamptz,
  revoked_at timestamptz,
  note text,
  created_by_identity_id uuid REFERENCES security.auth_identities(id),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT beta_invites_uses_within_max CHECK (use_count <= max_uses)
);

CREATE INDEX beta_invites_phone_idx ON app.beta_invites (phone_e164)
  WHERE phone_e164 IS NOT NULL AND revoked_at IS NULL;

CREATE TABLE app.beta_invite_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id uuid NOT NULL REFERENCES app.beta_invites(id),
  identity_id uuid REFERENCES security.auth_identities(id),
  phone_e164 text,
  redeemed_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  client_meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX beta_invite_redemptions_invite_idx
  ON app.beta_invite_redemptions (invite_id);

COMMENT ON TABLE app.beta_invites IS
  'Private Beta invite codes — Staging/Production hold until Owner opens access';
