# Milestone Report 8 — Promotions, Content, Reviews, TikTok, Customers และ Support

```text
MILESTONE: 8 — Promotions, Content, Reviews, TikTok, Customers และ Support
STATUS: PASS (awaiting Owner Review Gate 8)
IMPLEMENTED:
- Promotions: stacking, platform/supplier/split funding, budget/qty caps, 80/90% alerts, hard stop, cancel recalc
- Reviews: delivered verified purchase, 30d write / 7d edit + versions; supplier responses need approval
- TikTok: staff publish; supplier/customer moderation; HTTPS allowlist; suspicious auto-hide
- Customers: multi-address + default, recipient ≠ account, immutable order address snapshot
- Phone change dual OTP; private encrypted recovery docs; deletion OTP+approval with anonymize
- Marketing opt-in default true with easy opt-out; store delivery-only PII view
- Support: in-app/whatsapp/phone; same-day first response; urgent→lead+finance; SLA escalate; auto-close 3d; reopen
FILES / MIGRATIONS:
- supabase/migrations/20260903150000_promotions_reviews_customers_support.sql
- apps/api/src/modules/{promotions,content,customers,support,engagement}/*
VALIDATION:
- Typecheck/Lint/Build: PASS
- Unit/Integration: PASS (API 71 tests)
- pnpm audit --audit-level=high: PASS
SECURITY / DATA / MONEY / STOCK IMPACT:
- Order address snapshots immutable; recovery docs private/; anonymize keeps financial records
KNOWN ISSUES:
- Reports/notifications/OCR/EGO/backup continue in Milestone 9
COMMIT:
- 3a5dd84 — feat: Milestone 8 promotions, reviews, privacy, and support
DEPLOYMENT:
- ไม่ได้ deploy
NEXT ACTION:
- รอ Owner ตรวจรับ Milestone 8 (OWNER REVIEW GATE 8)
```
