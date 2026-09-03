# Architecture Decision Records (ADR)

This directory records significant technical decisions for BomBee Market.

## Format

Each ADR uses the filename pattern:

```text
NNNN-short-title.md
```

Example: `0001-monorepo-and-modular-monolith.md`

## Template

```markdown
# ADR NNNN: Title

- Status: Proposed | Accepted | Superseded | Deprecated
- Date: YYYY-MM-DD
- Deciders: Owner, Agent, …

## Context

What problem or constraint led to this decision?

## Decision

What did we choose?

## Consequences

Positive, negative, and follow-up work.
```

## Index

| ADR | Title | Status |
| --- | ----- | ------ |
| [0001](0001-monorepo-and-modular-monolith.md) | Monorepo and modular monolith | Accepted |
| [0002](0002-package-manager-and-typescript-strict.md) | Package manager and TypeScript strict | Accepted |
| [0003](0003-environment-separation.md) | Environment separation and fail-fast config | Accepted |
