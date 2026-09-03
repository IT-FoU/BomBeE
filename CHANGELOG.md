# Changelog

All notable changes to BomBee Market are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Milestone 0 — Repository and project foundation
  - TypeScript monorepo with `apps/customer`, `apps/backoffice`, `apps/api`, `packages/shared`, `packages/config`
  - Strict TypeScript, ESLint, Prettier, import boundaries, and environment schema validation
  - CI pipeline with lockfile-frozen install, typecheck, lint, unit tests, build, dependency scan, secret scan, and migration validation stub
  - Planning baseline (`requirements.md`, `tasks.md`), ADR directory, and contributor/security docs
