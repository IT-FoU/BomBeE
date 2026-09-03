# ADR 0001: Monorepo and Modular Monolith

- Status: Accepted
- Date: 2026-09-03
- Deciders: Owner (planning baseline), Cloud Agent (Milestone 0)

## Context

BomBee Market Phase 1 needs a customer PWA, a staff backoffice, and a backend that owns authorization, pricing, inventory, payments, and order state. Requirements specify a Modular Monolith that can split into services later, plus a new repository separate from EGO POS and other projects.

## Decision

Use a single pnpm workspace monorepo with:

- `apps/customer` — React + TypeScript PWA
- `apps/backoffice` — React + TypeScript staff UI
- `apps/api` — TypeScript modular monolith (module folders by domain)
- `packages/shared` — shared types and pure helpers
- `packages/config` — shared tooling and environment schemas

Domain modules inside `apps/api` keep clear boundaries (catalog, inventory, orders, payments, etc.) so extraction to services remains possible later.

## Consequences

- Shared types and tooling stay consistent across surfaces.
- Import boundaries prevent UI apps from reaching into API internals.
- Single CI pipeline covers the whole Phase 1 surface.
- Future service splits require extracting a module folder rather than rewriting from scratch.
