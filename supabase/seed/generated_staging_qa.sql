-- AUTO-GENERATED from tests/fixtures/staging-qa-catalog.json
-- Synthetic QA seed only. Do not apply to Production.
-- Requires migrations through 20260903170000_staging_beta_invites.sql

BEGIN;

INSERT INTO app.beta_invites (invite_code, intended_role, max_uses, note)
VALUES ('QA-BETA-001', 'ops', 5, 'generated from staging-qa-catalog')
ON CONFLICT (invite_code) DO NOTHING;

INSERT INTO app.beta_invites (invite_code, intended_role, max_uses, note)
VALUES ('QA-BETA-002', 'customer', 5, 'generated from staging-qa-catalog')
ON CONFLICT (invite_code) DO NOTHING;

INSERT INTO app.beta_invites (invite_code, intended_role, max_uses, note)
VALUES ('QA-BETA-003', 'customer', 5, 'generated from staging-qa-catalog')
ON CONFLICT (invite_code) DO NOTHING;

INSERT INTO app.beta_invites (invite_code, intended_role, max_uses, note)
VALUES ('QA-BETA-004', 'customer', 5, 'generated from staging-qa-catalog')
ON CONFLICT (invite_code) DO NOTHING;

INSERT INTO app.beta_invites (invite_code, intended_role, max_uses, note)
VALUES ('QA-BETA-005', 'customer', 5, 'generated from staging-qa-catalog')
ON CONFLICT (invite_code) DO NOTHING;

INSERT INTO app.beta_invites (invite_code, intended_role, max_uses, note)
VALUES ('QA-BETA-006', 'customer', 5, 'generated from staging-qa-catalog')
ON CONFLICT (invite_code) DO NOTHING;

INSERT INTO app.beta_invites (invite_code, intended_role, max_uses, note)
VALUES ('QA-BETA-007', 'customer', 5, 'generated from staging-qa-catalog')
ON CONFLICT (invite_code) DO NOTHING;

INSERT INTO app.beta_invites (invite_code, intended_role, max_uses, note)
VALUES ('QA-BETA-008', 'customer', 5, 'generated from staging-qa-catalog')
ON CONFLICT (invite_code) DO NOTHING;

INSERT INTO app.beta_invites (invite_code, intended_role, max_uses, note)
VALUES ('QA-BETA-009', 'customer', 5, 'generated from staging-qa-catalog')
ON CONFLICT (invite_code) DO NOTHING;

INSERT INTO app.beta_invites (invite_code, intended_role, max_uses, note)
VALUES ('QA-BETA-010', 'customer', 5, 'generated from staging-qa-catalog')
ON CONFLICT (invite_code) DO NOTHING;

-- Catalog/store product rows need auth + store domain IDs;
-- keep product JSON fixture for PWA/API tests until hosted Staging exists.
SELECT 'seed_invites' AS kind, count(*)::int AS n FROM app.beta_invites WHERE note LIKE 'generated from staging-qa-catalog%';

COMMIT;

