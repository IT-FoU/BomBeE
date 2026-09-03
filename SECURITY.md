# Security Policy

## Supported Environments

| Environment | Support |
| ----------- | ------- |
| Local       | Development only; mock data and mock providers |
| Staging     | Pre-release QA; mock/sandbox integrations |
| Production  | Private beta and later; Owner approval required |

## Reporting a Vulnerability

Do **not** open a public GitHub issue for security problems.

Report privately to the Owner / security contact for the `IT-FoU/BomBeE` repository.

Include:

- Description of the issue and impact
- Steps to reproduce
- Affected environment (Local / Staging / Production)
- Suggested remediation if known

## Hard Rules (Phase 1)

1. Never commit secrets, OTP codes, API keys, service-role keys, or real customer data.
2. Never point Local/Staging credentials at Production resources.
3. Never enable the EGO POS feature flag or send real integration traffic in Phase 1.
4. Money amounts are integer LAK (kip); never use floating point for money.
5. Audit logs are append-only; never mutate or delete historical audit rows from application roles.
6. Private media uses signed access; do not publish unnecessary public URLs.
7. Production deploy requires written Owner approval.

## Secret Handling

- Use `.env.example` templates only in git.
- Real secrets live in environment secret stores per environment.
- Rotate any credential that may have been exposed immediately and record an audit note.
