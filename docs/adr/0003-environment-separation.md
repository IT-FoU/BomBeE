# ADR 0003: Environment Separation and Fail-Fast Config

- Status: Accepted
- Date: 2026-09-03
- Deciders: Cloud Agent (Milestone 0), pending Owner confirmation

## Context

Requirements forbid Local/Staging from using Production credentials or real customer data. Misconfigured environments are a high-severity risk for payments and PII.

## Decision

- Validate environment variables with a Zod schema at process start (`packages/config`).
- Fail fast if required config is missing or invalid.
- Provide `.env.example` plus environment-specific example files without secrets.
- Embed an `APP_ENV` value of `local` | `staging` | `production`.
- Guardrails reject combinations such as `APP_ENV=local` with production Supabase URLs/keys patterns.
- EGO POS feature flag defaults to `false` in every environment.

## Consequences

- Apps refuse to boot with incomplete or unsafe config.
- CI and local onboarding use documented example files only.
- Production deploy remains Owner-gated; this ADR does not authorize production credentials in the repo.
