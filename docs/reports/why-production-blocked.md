# Why Production apply stopped (Owner briefing)

## สาเหตุ (ภาษาคน)

ระบบโค้ด Milestone 0–12 + คำสั่ง「อนุมัติ deploy production」พร้อมแล้ว  
แต่ **ยังไม่มี “บ้าน” ให้ขึ้นของจริง**:

1. **ยังไม่มี Production Database บน Supabase** (Owner ยืนยัน 2026-09-04)
2. ในเครื่อง Cloud Agent **ไม่มี** Production secrets / URL / คำสั่ง deploy ไป host จริง
3. ใน repo **ยังไม่มี** Dockerfile / Fly / Vercel ผูก host ไว้

เลยทำได้แค่ dry-run + แพ็กสคริปต์ — **apply จริงไปต่อไม่ได้** โดยไม่เดา credentials

## ต้องเข้าตั้งค่าที่คอมตัวเองไหม?

**ไม่จำเป็น** สำหรับการปิด Milestone รอบนี้ (ใช้ mock ตามคำสั่ง Owner)

ถ้าจะขึ้น Production จริงทีหลัง ตั้งค่าที่ **บัญชี cloud / GitHub** ไม่ใช่แค่โฟลเดอร์โปรเจกต์บน PC:

| ที่ไหน | ทำอะไร |
| --- | --- |
| [Supabase](https://supabase.com) | สร้างโปรเจกต์ **Production** แยกจาก Staging → ได้ Database URL + keys |
| Host (เช่น Vercel / Fly / Railway — เลือกอันหนึ่ง) | สร้างแอปชี้ repo + ใส่ env |
| GitHub → Settings → Environments → `production` | ใส่ secrets ตาม `docs/runbooks/production-deploy.md` |
| GitHub Actions | รัน workflow **Production Deploy** (confirm `DEPLOY-PRODUCTION`, tag `v0.12.0`) |

คอมส่วนตัวใช้แค่ browser login เข้าบริการพวกนี้ — **ไม่ต้องติดตั้ง Supabase ลงเครื่อง** ก็ได้

## Owner decision (2026-09-04)

> เนื่องจากยังไม่ได้เตรียม Production Database บน Supabase ให้ใช้ Mock Data หรือข้ามขั้นตอนการใส่ Production Secrets แล้วสรุปปิด Milestone นี้ได้เลย

→ ปิด Phase 1 packaging ด้วย mock / N/A (ดู `docs/reports/final-completion-report.md`)

## Update (2026-09-04)
Phase 1 โค้ดถูก fast-forward เข้า `main` แล้ว (`cf10a6b`). รัน local/mock จาก `main` ได้ทันที — Production live ยังเลื่อนตามคำสั่ง Owner.
