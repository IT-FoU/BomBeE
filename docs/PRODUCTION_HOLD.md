# PRODUCTION HOLD

## Status
**CLOSED FOR PHASE 1 PACKAGING — Production live deferred**

- Written Owner order: **「อนุมัติ deploy production」** (2026-09-03)
- Follow-up Owner order (2026-09-04): **ข้าม Production secrets / ใช้ mock** เพราะยังไม่มี Supabase Production DB → **ปิด Milestone**

## Meaning
- Phase 1 โค้ด + เกต + deploy packaging ปิดรอบแล้ว
- Production URL จริง **ยังไม่มี** จนกว่าจะเตรียม Supabase Production + host + secrets
- เมื่อพร้อม: ทำตาม `docs/runbooks/production-deploy.md`

## Runtime flags (เมื่อขึ้นของจริงทีหลัง)
```bash
OWNER_PRODUCTION_DEPLOY_APPROVED=true
INTEGRATIONS_MODE=sandbox   # จนกว่าจะอนุมัติ live credentials แยก
INVITE_ONLY_ENABLED=true
EGO_POS_ENABLED=false
```
