# Test fixtures

Synthetic data only. Never commit real customer, store, payment, or credential data.

| File | Purpose |
| ---- | ------- |
| `demo-catalog.json` | Demo customers, stores, products for local/CI seeds |
| `fixture.schema.json` | Informal shape note for fixture files |

SQL seed migrations arrive in Milestone 1+ and must load from these fixtures (or equivalents), not from production exports.
