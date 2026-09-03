# ADR 0004: Customer PWA performance budgets

## Status
Accepted — Milestone 11

## Context
Customer PWA must remain usable on mid-range Android devices in Vientiane on mobile networks.

## Decision
Phase 1 budgets (uncompressed transfer, production build):
- Initial JS bundle (customer app entry chunk): ≤ 250 KB gzip
- CSS: ≤ 50 KB gzip
- Largest contentful paint target on mid-range: ≤ 3.5s on 4G
- Service worker caches shell only; never caches account/payment/checkout/OTP

## Consequences
- Prefer hash routing and fixture-backed UI over heavy client frameworks
- Measure budgets in CI via Vite build size reporting
- Defer analytics SDKs until after Owner release authorization
