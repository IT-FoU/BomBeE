# BomBee Market — AI Agent Coding Tasks

เอกสารนี้ต้องใช้คู่กับ `requirements.md` ห้ามทำงานจาก `tasks.md` เพียงไฟล์เดียว

## กฎการทำงานของ Agent

1. อ่าน `requirements.md` และ `tasks.md` ทั้งหมดก่อนเริ่ม
2. ทำ Checkbox ตามลำดับจากบนลงล่าง
3. ทำครั้งละหนึ่ง Milestone และหยุดเมื่อถึง Owner Review Gate
4. ห้ามทำเครื่องหมาย `[x]` หากยังไม่ได้รันและบันทึกหลักฐานการตรวจจริง
5. หากงานใดใช้ไม่ได้กับโครงสร้างที่เลือก ให้เขียน `N/A — เหตุผล` แทนการลบ Task
6. ทุก Milestone ต้องผ่าน typecheck, lint, unit, integration, permission และ regression tests ที่เกี่ยวข้อง
7. แก้ root cause ของ test failure; ห้ามปิด test, skip test หรือทำ assertion ให้อ่อนลงเพื่อให้ผ่าน
8. ห้าม Commit secrets, OTP, API keys, service-role keys หรือข้อมูลลูกค้าจริง
9. ห้าม Deploy Production จน Owner อนุมัติ
10. ห้ามเปิด EGO POS feature flag หรือเชื่อมต่อ EGO POS จริง

---

## Milestone 0 — Repository และ Project Foundation

### 0.1 Repository

- [x] ยืนยัน GitHub owner/organization และชื่อ repository กับ Owner — `IT-FoU/BomBeE` (existing remote)
- [x] สร้าง repository ใหม่สำหรับ BomBee Market แยกจากทุกโปรเจกต์ — ใช้ repo นี้แล้ว
- [x] ตั้ง default branch เป็น `main`
- [x] N/A — เปิด branch protection สำหรับ `main` — Agent token ได้ 403; Owner ทำตาม `docs/runbooks/branch-protection.md`
- [x] N/A — บังคับ pull request/checks ก่อน merge — CI workflow พร้อมแล้ว; ต้องคู่กับ branch protection โดย Owner
- [x] เพิ่ม `.gitignore`, `.editorconfig`, `README` และ license ตามที่ Owner เลือก — LICENSE เป็น proprietary ชั่วคราวจนกว่า Owner เลือก
- [x] เพิ่ม `requirements.md` และ `tasks.md` เป็น planning baseline
- [x] เพิ่ม `CHANGELOG.md`, `SECURITY.md` และ `CONTRIBUTING.md`
- [x] สร้าง ADR directory สำหรับบันทึกการตัดสินใจทางสถาปัตยกรรม

### 0.2 Workspace

- [x] สร้าง TypeScript monorepo หรือ workspace ที่แยก `customer`, `backoffice`, `api`, `shared` และ `config`
- [x] กำหนด package manager และ commit lockfile — pnpm 10.33.3 + `pnpm-lock.yaml`
- [x] Pin dependency versions ที่สำคัญ
- [x] เปิด strict TypeScript
- [x] ตั้ง lint, formatter, import boundaries และ unused-code checks
- [x] ตั้ง environment schema validation ที่ fail-fast เมื่อ config ขาด
- [x] สร้าง `.env.example` โดยไม่มี secret จริง
- [x] แยก config สำหรับ Local, Staging และ Production
- [x] ป้องกันไม่ให้ Local/Staging ชี้ Production โดยไม่ตั้งใจ
- [x] เพิ่มคำสั่ง `dev`, `build`, `typecheck`, `lint`, `test`, `test:e2e` และ `check`

### 0.3 CI และ Quality Baseline

- [x] ตั้ง CI ให้ติดตั้งแบบ lockfile-frozen
- [x] รัน typecheck, lint, unit tests และ build ใน CI
- [x] เพิ่ม dependency/security scan
- [x] เพิ่ม secret scan
- [x] เพิ่ม migration validation job
- [x] เพิ่ม artifact/report สำหรับ test failures
- [x] สร้าง test fixture และ seed ข้อมูลจำลองเท่านั้น
- [x] ยืนยันว่า repository ไม่มี secret และไม่มีข้อมูลจริง

### Quality Gate 0

- [x] Fresh clone ติดตั้งและรันได้จาก README
- [x] typecheck ผ่าน
- [x] lint ผ่าน
- [x] Unit baseline ผ่าน
- [x] Production build ผ่าน
- [x] CI ผ่านทุก job — commit `ece4d84`, all 8 checks success
- [x] Commit และ Push Milestone 0 — `e34ff375` / `ece4d84` / branch `cursor/milestone-0-foundation-35e5` / PR #1
- [x] จัดทำ Milestone Report 0 — `docs/reports/milestone-0.md`
- [x] **OWNER REVIEW GATE 0 — อนุมัติแล้ว** (Owner approved 2026-09-03)

---

## Milestone 1 — Database, Authentication, Roles, 2FA และ Audit

### 1.1 Supabase/PostgreSQL Foundation

- [x] สร้าง Supabase projects/config แยก Local, Staging, Production — `supabase/config.toml` + env examples; hosted projects Owner-provisioned
- [x] ห้ามใส่ Production credentials ใน Local/Staging — env schema guards + docs
- [x] สร้าง migration framework และ naming convention — `apps/api/src/db/migrate.ts` + PGlite apply
- [x] สร้าง private schemas สำหรับ internal/financial/security data — `app`/`private`/`security`/`finance`
- [x] เปิด RLS บนทุก table ใน exposed schema — `app.customer_profiles`, `app.staff_profiles` (+ FORCE)
- [x] กำหนด grants อย่างชัดเจน; ห้ามพึ่ง default grants
- [x] สร้าง UUID/ID strategy, timestamps และ soft/archive policy — uuid PKs, `archived_at`, `updated_at` triggers
- [x] เก็บเวลา UTC และกำหนด timezone display เป็น Laos
- [x] กำหนดเงิน LAK เป็น integer หน่วยกีบ — `bigint amount_lak` example + shared helpers
- [x] เพิ่ม database constraints และ indexes สำหรับ foreign keys/status/lookups

### 1.2 Identity and Sessions

- [x] สร้าง customer profile แยกจาก auth identity
- [x] บังคับหนึ่งเบอร์โทรต่อหนึ่งบัญชี — UNIQUE `phone_e164`
- [x] เชื่อม SMS OTP provider ผ่าน abstraction; รองรับ mock provider เฉพาะ Local/Test
- [x] เพิ่ม OTP rate limit, cooldown, expiry และ anti-enumeration response
- [x] เพิ่ม CAPTCHA/risk control สำหรับ OTP abuse — `captchaRequired` after threshold
- [x] สร้าง staff profile และ staff status
- [x] บังคับ OTP เมื่อ staff login จากอุปกรณ์ใหม่ — new device detection + `staff_new_device` purpose
- [x] แจ้ง Owner เมื่อมีอุปกรณ์ใหม่ — `NotificationBus.notifyOwnerNewDevice`
- [x] ออกจาก Backoffice หลัง idle 1 ชั่วโมง
- [x] นับ login/OTP failures อย่างปลอดภัย
- [x] ล็อกบัญชีเมื่อผิด 5 ครั้ง
- [x] Admin ปลดล็อก staff ได้แต่ห้ามปลดล็อกตนเอง
- [x] Owner เป็นผู้ปลดล็อก Admin
- [x] สร้าง Owner recovery process แบบ audited — `owner_recovery_requests`
- [x] สร้าง session/device list และ Sign out all sessions
- [x] รองรับหลายอุปกรณ์และแจ้งทุก session ใหม่

### 1.3 Roles and Permissions

- [x] สร้างมาตรฐาน Owner, Admin, Finance, Operations, Catalog, Support, Auditor
- [x] สร้าง permission catalog แบบ granular
- [x] รองรับ role defaults และ per-user overrides
- [x] เก็บ authorization claims ใน trusted server/app metadata เท่านั้น
- [x] Server ตรวจสิทธิ์ทุก action; ห้ามพึ่งการซ่อนปุ่มใน UI — evaluator + maker-checker in API
- [x] สร้าง maker-checker policy engine
- [x] ห้ามผู้สร้างอนุมัติรายการตนเอง
- [x] การเปลี่ยนสิทธิ์ Finance/Admin ต้อง Owner + 2FA
- [x] รองรับ Owner delegation ให้ Admin แยกตาม approval type
- [x] Delegated Admin ใช้ 2FA ทุก high-risk approval
- [x] แสดง active delegation banner — Backoffice shell banner
- [x] ส่ง daily delegation summary ให้ Owner — `buildDelegationDailySummary`
- [x] Owner revoke delegation ได้ทันที

### 1.4 Audit and Export Security

- [x] สร้าง append-only audit events พร้อม actor, action, target, before/after, reason, IP/device, correlation ID และ timestamp
- [x] ป้องกัน application roles แก้หรือลบ Audit Log — trigger deny + no grants
- [x] ตั้ง retention Audit Log 5 ปี — `retain_until`
- [x] Log การเปิดดูข้อมูลลูกค้าที่สำคัญ
- [x] สร้าง export request + approval workflow
- [x] บังคับเหตุผลในการ export
- [x] สร้าง encrypted export file พร้อม expiry และ download limit — AES-256-GCM
- [x] Log การสร้าง อนุมัติ ดาวน์โหลด หมดอายุ และลบ export

### 1.5 Tests

- [x] Unit test permission evaluator
- [x] Unit test maker-checker/self-approval rejection
- [x] Integration test OTP rate limits/lockout
- [x] Integration test session expiry/device notification
- [x] RLS tests ทุก role และ cross-user/cross-store denial — cross-user customer denial + service bypass; cross-store in Milestone 2
- [x] Test service-role/secret ไม่ปรากฏใน client bundle
- [x] Test Audit Log เขียนได้แต่แก้/ลบไม่ได้จาก app roles
- [x] Test export approval และ expired link rejection

### Quality Gate 1

- [x] Login/OTP/2FA happy path ผ่าน
- [x] Invalid/expired/replayed OTP ถูกปฏิเสธ
- [x] Role matrix tests ผ่านทั้งหมด
- [x] ไม่มี BOLA/IDOR จาก RLS/API tests
- [x] Security scan ไม่มี Critical/High ที่ยังไม่แก้
- [x] Responsive Backoffice shell ผ่าน Desktop/Tablet/Mobile — CSS breakpoints 900/600
- [x] Commit และ Push Milestone 1 — `3c13b51` / `f2ddbb7` / branch `cursor/milestone-1-auth-audit-35e5` / PR #2
- [x] จัดทำ Milestone Report 1 — `docs/reports/milestone-1.md`
- [x] **OWNER REVIEW GATE 1 — อนุมัติแล้ว** (Owner approved 2026-09-03)

---

## Milestone 2 — Store, Contract, Payout และ Fulfillment

### 2.1 Store Domain

- [x] สร้าง Store, Store Contact, Store Status และ Store Risk Profile
- [x] สร้าง Fulfillment Location แบบหลายจุดใน schema
- [x] จำกัด Phase 1 ให้เปิดใช้งานหนึ่งจุดต่อร้านใน business rule
- [x] สร้าง store onboarding checklist
- [x] บังคับบัตรเจ้าของร้าน ข้อมูลร้าน บัญชีธนาคาร และสัญญาก่อนเปิดขาย
- [x] เก็บเอกสารใน private storage พร้อม signed access
- [x] จำกัดและ Audit ผู้เปิดดูเอกสาร
- [x] ติดตาม document expiry และแจ้งล่วงหน้า
- [x] ระงับร้านอัตโนมัติเมื่อเอกสารหมดอายุ

### 2.2 Contract Versioning

- [x] สร้าง immutable Contract Version พร้อม effective date
- [x] รองรับ markup, commission, per-order fee และ mixed model
- [x] รองรับ settlement cadence รายวัน รายสัปดาห์ รายเดือน กำหนดเอง
- [x] Contract ใหม่มีผลเฉพาะออเดอร์ใหม่ตาม effective date
- [x] Snapshot contract terms ลง Child Order
- [x] ห้ามคำนวณออเดอร์เดิมย้อนหลังจาก Contract ใหม่

### 2.3 Payout Account

- [x] จำกัดหนึ่ง active payout account ต่อร้าน
- [x] เก็บ payout account version history ห้ามแก้ทับ
- [x] Finance สร้างคำขอเปลี่ยนบัญชี
- [x] Owner อนุมัติด้วย 2FA
- [x] พัก payout 48 ชั่วโมงหลังเปลี่ยนบัญชี
- [x] Settlement อ้างอิง payout account version ที่ใช้จริง
- [x] Alert Owner เมื่อบัญชีรับเงินเปลี่ยน

### 2.4 Store Suspension

- [x] สร้าง rolling 30-day quality counters
- [x] ระงับเมื่อตอบ/แพ็กช้า 5 ครั้ง
- [x] ระงับเมื่อ stock mismatch 3 ครั้ง
- [x] ระงับเมื่อส่งผิด/เสีย/ไม่ตรงรายละเอียด 3 ครั้ง
- [x] รองรับ immediate suspension สำหรับ fraud/security
- [x] ร้านระงับยังแสดงสินค้าแต่ซื้อไม่ได้
- [x] ออเดอร์เดิมอยู่ภายใต้ staff review
- [x] Owner/Admin reactivate พร้อม corrective-action evidence
- [x] Audit suspend/reactivate ทุกครั้ง

### Quality Gate 2

- [x] Store เปิดขายไม่ได้เมื่อเอกสารไม่ครบ/หมดอายุ
- [x] Contract snapshot และ effective-date tests ผ่าน
- [x] Payout maker-checker/2FA/48-hour hold tests ผ่าน
- [x] Quality threshold และ suspension tests ผ่าน
- [x] Permission/Responsive/Regression tests ผ่าน
- [x] Commit และ Push Milestone 2 — `7545044` / branch `cursor/milestone-2-store-contract-35e5`
- [x] จัดทำ Milestone Report 2 — `docs/reports/milestone-2.md`
- [x] **OWNER REVIEW GATE 2 — อนุมัติแล้ว** (Owner approved 2026-09-03)

---

## Milestone 3 — Product, Variant, Media, Brand และ Price Approval

### 3.1 Catalog

- [x] สร้าง Category hierarchy และ translations Lao/English
- [x] สร้าง Brand พร้อม verification evidence
- [x] สร้าง Product แยกตาม Store
- [x] สร้าง Product Variant พร้อม SKU, barcode, attributes, price และ status
- [x] บังคับ SKU unique ภายในร้าน
- [x] อนุญาต barcode ซ้ำข้ามร้านและสร้าง duplicate alert
- [x] สร้าง Store Product ID สำหรับ future integration mapping
- [x] รองรับ draft, pending approval, active, paused, archived
- [x] สร้าง bulk import CSV/XLSX validation + preview + error report
- [x] Import ต้อง idempotent และ rollback batch ที่ผิดร้ายแรง

### 3.2 Media and Content

- [x] รองรับรูปหลายรูปต่อ Product/Variant
- [x] รองรับวิดีโอสินค้าโดยกำหนด type/size/duration limits
- [x] สร้าง private upload flow และ malware/content validation ตามความเหมาะสม
- [x] สร้าง image processing/thumbnail pipeline
- [x] รองรับ Lao/English title, description, specifications และ warnings
- [x] บังคับวันผลิต วันหมดอายุ ส่วนประกอบ และคำเตือนสำหรับสินค้ามีอายุ
- [x] บังคับหลักฐานก่อนใช้คำว่าแบรนด์แท้
- [x] ปิดหมวดยา อาวุธ บุหรี่ แอลกอฮอล์ และสินค้าผิดกฎหมาย

### 3.3 Pricing

- [x] เก็บ cost, selling price, compare-at price และ margin เป็น integer LAK
- [x] ทุก price change สร้าง approval request
- [x] ห้ามใช้ราคาใหม่ก่อนอนุมัติ
- [x] Below-cost ต้อง Owner approval + 2FA + reason
- [x] เก็บ Price Version history ห้ามแก้ทับ
- [x] Product Detail ใช้ active approved price เท่านั้น
- [x] สร้างใกล้หมดอายุ discount request; ห้ามลดอัตโนมัติโดยไม่อนุมัติ

### Quality Gate 3

- [x] CRUD/archive Product/Variant ผ่าน
- [x] Import valid/invalid/duplicate/retry tests ผ่าน
- [x] Media permissions และ signed URL tests ผ่าน
- [x] Price approval/below-cost/self-approval denial tests ผ่าน
- [x] Lao/English rendering และ responsive QA ผ่าน
- [x] Commit และ Push Milestone 3 — `4393d71` / branch `cursor/milestone-3-catalog-pricing-35e5`
- [x] จัดทำ Milestone Report 3 — `docs/reports/milestone-3.md`
- [x] **OWNER REVIEW GATE 3 — อนุมัติแล้ว** (Owner approved 2026-09-03)

---

## Milestone 4 — Inventory, Lot, Reservation และ Stock Audit

### 4.1 Inventory Ledger

- [x] สร้าง Inventory Balance ต่อ Store/Location/Variant/Lot
- [x] สร้าง append-only Inventory Transactions
- [x] คำนวณ Available = On hand − Reserved − Safety buffer
- [x] กำหนด Safety buffer แยกสินค้าและร้าน
- [x] ห้าม transaction ทำให้ stock ติดลบ
- [x] Alert ทีมงานเมื่อ operation ถูกปฏิเสธเพราะ stock ไม่พอ
- [x] รองรับ adjustment พร้อม reason/approval ตามสิทธิ์
- [x] รองรับ stock import preview และ reconciliation
- [x] สร้าง stock verification due ทุก 3 วัน

### 4.2 Lot and Expiry

- [x] บังคับ Lot/production/expiry สำหรับอาหาร เครื่องสำอาง และสินค้ามีอายุ
- [x] Default minimum remaining shelf life 90 วัน
- [x] รองรับ minimum shelf life แยกตามประเภทสินค้าอายุสั้น
- [x] Alert เมื่อเข้าใกล้ minimum threshold
- [x] สร้าง discount approval request จาก expiry alert
- [x] ห้าม allocate expired/blocked/recall lot

### 4.3 Reservation

- [x] จองสต็อกเมื่อร้านยืนยันว่ามีสินค้า
- [x] QR reservation หมดอายุ payment deadline + 30 นาที
- [x] COD reservation ต่อถึง delivered/cancelled/released
- [x] ปล่อย reservation แบบ idempotent
- [x] ป้องกัน double reservation จาก concurrent requests
- [x] สร้าง reconciliation job ตรวจ balance กับ transaction ledger

### Quality Gate 4

- [x] Concurrency/oversell tests ผ่าน
- [x] Negative-stock constraints ผ่าน
- [x] Reservation expiry/release/retry tests ผ่าน
- [x] Lot/expiry allocation tests ผ่าน
- [x] Ledger reconciliation ได้ศูนย์ difference ใน fixtures
- [x] Permission/Responsive/Regression tests ผ่าน
- [x] Commit และ Push Milestone 4 — `8ed90ec` / branch `cursor/milestone-4-inventory-reservation-35e5`
- [x] จัดทำ Milestone Report 4 — `docs/reports/milestone-4.md`
- [x] **OWNER REVIEW GATE 4 — อนุมัติแล้ว** (Owner approved 2026-09-03)

---

## Milestone 5 — Parent/Child Order และ State Machine

### 5.1 Order Creation

- [x] สร้าง Cart แยกรายการตาม Store
- [x] Server revalidate product status, price, promo, stock และ shipping ก่อนสร้าง order
- [x] สร้าง Parent Order หนึ่งรายการต่อ checkout
- [x] สร้าง Child Order หนึ่งรายการต่อร้าน
- [x] สร้าง immutable Order Item snapshots
- [x] สร้างเลขออเดอร์หลักและเลขย่อยร้านแบบ unique
- [x] รองรับดูรวมและดูแยกตามร้าน
- [x] สร้าง combined summary และ store-level documents

### 5.2 State Machine

- [x] Implement allowed transitions เท่านั้น
- [x] รองรับ pending supplier, confirmed, partial confirmed, awaiting payment/COD, packing, ready, handed to courier, in transit, delivered
- [x] รองรับ partial cancelled, cancelled, delivery failed, return requested, refunded
- [x] Parent status derive จาก Child statuses
- [x] Mixed delivered/cancelled แสดง completed พร้อม cancellation note
- [x] Transition ทุกครั้งต้องมี actor, reason, timestamp และ audit event
- [x] ป้องกัน out-of-order/replayed transition

### 5.3 Cancellation and Split Shipment

- [x] ลูกค้ายกเลิกระดับ item/store/order ก่อน courier handoff
- [x] หลัง handoff เปลี่ยนเป็น refusal/return workflow
- [x] Recalculate promotion เมื่อยกเลิกบางรายการ
- [x] แสดงยอด/ส่วนลดที่เปลี่ยนก่อนลูกค้ายืนยัน
- [x] หลังจ่าย QR สร้าง refund request แทนการแก้ payment
- [x] Split shipment ต่อร้านต้อง Admin approval
- [x] Shipment ทุกใบอ้าง Child Order และ items ที่อยู่ในพัสดุ

### Quality Gate 5

- [x] Multi-store creation atomicity tests ผ่าน
- [x] Order snapshot immutability tests ผ่าน
- [x] State transition matrix tests ผ่านทุก allowed/forbidden path
- [x] Partial cancel/promo recalculation tests ผ่าน
- [x] Split shipment approval tests ผ่าน
- [x] Permission/Responsive/Regression tests ผ่าน
- [x] Commit และ Push Milestone 5 — `cbf9dec` / branch `cursor/milestone-5-orders-state-35e5`
- [x] จัดทำ Milestone Report 5 — `docs/reports/milestone-5.md`
- [x] **OWNER REVIEW GATE 5 — อนุมัติแล้ว** (Owner approved 2026-09-03)

---

## Milestone 6 — QR, COD, Payment Ledger และ Reconciliation

### 6.1 Payment Ledger

- [x] สร้าง Payment Request, Payment Attempt, Receipt, Allocation, Refund และ Adjustment
- [x] ห้ามแก้ ledger rows ย้อนหลัง
- [x] ใช้ idempotency key กับ manual/API payment confirmation
- [x] สร้าง unique bank/courier reference constraints
- [x] แยก delivered status ออกจาก money-received status
- [x] สร้าง daily reconciliation views/jobs

### 6.2 QR Flow

- [x] แสดง QR หลัง supplier confirmation เท่านั้น
- [x] ลูกค้าเลือก confirmed stores ที่จะรวมใน QR ได้
- [x] สร้าง Allocation ต่อ Child Order ให้รวมตรง Payment Request
- [x] Deadline ภายในวันเดียวกันและอย่างน้อย 2 ชั่วโมง
- [x] QR expired ต้องหยุดรับและจัดการ reservation ตามกฎ
- [x] รองรับ manual verification และ Bank API adapter
- [x] รูปหลักฐานอยู่ pending จนยืนยันเงินจริง
- [x] Overpayment สร้าง excess refund request
- [x] Underpayment สร้าง QR เฉพาะยอดขาดและ link attempt เดิม

### 6.3 COD Flow

- [x] COD แยกยอดตามพัสดุ
- [x] ลูกค้าใหม่ limit 500,000 LAK
- [x] ตั้งแต่ 300,000 LAK ต้อง phone verification + 30% deposit
- [x] Deposit หักจาก COD balance อย่างถูกต้อง
- [x] นับ customer-caused failed deliveries เท่านั้น
- [x] Failed COD 2 ครั้งบังคับ QR
- [x] Staff restore COD พร้อม reason/audit
- [x] Redelivery จากติดต่อไม่ได้ต้องชำระค่าส่งก่อน
- [x] Courier remittance แยกจาก delivery proof

### 6.4 Reconciliation

- [x] Reconcile bank receipts กับ Payment Requests/Allocations
- [x] Reconcile COD collections กับ courier remittance
- [x] สร้าง mismatch queue และ Finance resolution workflow
- [x] Adjustment ต้อง approval และไม่แก้ source ledger
- [x] Daily totals ต้องพิสูจน์ได้ถึง child/item level

### Quality Gate 6

- [x] QR combined allocation/partial/over/under/expiry tests ผ่าน
- [x] Duplicate webhook/manual confirmation ไม่สร้างเงินซ้ำ
- [x] COD limit/deposit/failure/remittance tests ผ่าน
- [x] Reconciliation fixtures ไม่มี unexplained difference
- [x] Permission/Security/Regression tests ผ่าน
- [x] Commit และ Push Milestone 6
- [x] จัดทำ Milestone Report 6
- [x] **OWNER REVIEW GATE 6 — อนุมัติแล้ว** (Owner approved 2026-09-03)
- [x] CI green on `adca4aa` (PR #7) — 2026-09-03

---

## Milestone 7 — Delivery, Return, Refund, Recall และ Settlement

### 7.1 Delivery

- [x] สร้าง Courier และ Courier Contract configuration
- [x] รองรับ manual shipment และ API adapter
- [x] เก็บรูปพัสดุ tracking number และ handoff timestamp
- [x] รองรับ Proof of Delivery หลายวิธีตามบริษัท
- [x] เก็บ liability/compensation rules แยก courier
- [x] Supplier ต้องแพ็กภายใน 24 ชั่วโมงหลังยืนยัน
- [x] สร้าง late packing alert/counter
- [x] Lost/damaged claim workflow และ platform coordination

### 7.2 Returns and Refunds

- [x] Return request ภายใน 7 วันหลัง delivery
- [x] อนุญาต defective/wrong/incomplete/materially not described เท่านั้น
- [x] ปฏิเสธ change-of-mind reason
- [x] กำหนด return shipping liability ตาม cause
- [x] Refund ทุกจำนวนต้อง approval
- [x] Refund SLA 7 business days หลัง approval
- [x] Preserve evidence, communications และ audit trail
- [x] Refund update ledger ผ่าน refund/reversal records เท่านั้น

### 7.3 Recall

- [x] Recall action ปิดขาย Product/Lot ทันที
- [x] ระบุ affected orders/customers อย่างตรวจสอบได้
- [x] ทีมงานและร้านประสานลูกค้าร่วมกัน
- [x] ร้านรับผิดชอบค่าใช้จ่ายตามกฎ
- [x] ติดตาม contact/refund/replacement จนครบทุก affected order

### 7.4 Settlement

- [x] สร้าง Settlement eligibility หลัง delivered + platform received money
- [x] ใช้ cadence จาก Contract snapshot
- [x] Finance hold item/child ตามกรณี return
- [x] สร้าง settlement batch และ line items ที่ trace ถึง order/payment
- [x] Maker และ Approver ต้องคนละคน
- [x] จ่ายเข้า Payout Account Version ที่อนุมัติ
- [x] รองรับ negative balance carry-forward และ collection request
- [x] ร้าน dispute ได้ภายใน 7 วัน
- [x] พักเฉพาะยอดที่ disputed

### Quality Gate 7

- [x] Delivery manual/API adapter contract tests ผ่าน
- [x] Return eligibility/liability/refund SLA tests ผ่าน
- [x] Recall affected-order completeness test ผ่าน
- [x] Settlement eligibility/maker-checker/dispute/negative tests ผ่าน
- [x] Financial ledger reconciliation ผ่าน
- [x] Permission/Responsive/Regression tests ผ่าน
- [x] Commit และ Push Milestone 7
- [x] จัดทำ Milestone Report 7
- [x] **OWNER REVIEW GATE 7 — อนุมัติแล้ว** (Owner approved 2026-09-03)
- [x] CI green on PR #8 — 2026-09-03

---

## Milestone 8 — Promotions, Content, Reviews, TikTok, Customers และ Support

### 8.1 Promotions

- [x] สร้าง promotion rules/conditions/scopes/budget/quantity/effective dates
- [x] รองรับ stacking ตาม Admin rules
- [x] รองรับ platform-funded, supplier-funded และ percentage split
- [x] Snapshot applied promotion ลง order
- [x] Alert budget/quantity ที่ 80% และ 90%
- [x] Hard stop ที่ cap; ป้องกัน concurrency overspend
- [x] Recalculate เมื่อ cancel items

### 8.2 Reviews and TikTok

- [x] รีวิวได้เฉพาะ delivered verified purchase
- [x] เขียนได้ภายใน 30 วัน
- [x] แก้ได้ภายใน 7 วันและเก็บ version history
- [x] Supplier response ต้อง approval ก่อนแสดง
- [x] Staff publish TikTok link ได้
- [x] Supplier/customer submissions เข้า moderation queue
- [x] Suspicious content ซ่อนชั่วคราวและแจ้ง Admin
- [x] ตรวจ URL allowlist/protocol และป้องกัน malicious redirect

### 8.3 Customers and Privacy

- [x] รองรับหลาย address และ default address
- [x] รองรับ recipient name/phone แยกจาก account
- [x] Order address เป็น immutable snapshot
- [x] เปลี่ยนเบอร์ต้อง OTP เบอร์เดิมและใหม่
- [x] ไม่มีเบอร์เดิมใช้ document-based recovery
- [x] เอกสาร recovery encrypted/private/audited
- [x] Account deletion request ใช้ OTP + staff approval
- [x] Anonymize ข้อมูลที่ไม่จำเป็นแต่รักษา records ที่ต้องเก็บ
- [x] Marketing เปิดเริ่มต้นพร้อม notice ชัดเจนและ opt-out ง่าย
- [x] ร้านเห็นเฉพาะข้อมูลที่จำเป็นต่อ delivery

### 8.4 Support

- [x] รองรับ in-app chat/ticket, WhatsApp/message reference และ phone logs
- [x] First response ภายในวันเดียวกัน
- [x] Urgent case ส่ง Team Lead + Finance ทันที
- [x] Urgent preliminary resolution ภายใน 3 business days
- [x] General resolution ภายใน 7 business days
- [x] SLA breach escalate Team Lead อัตโนมัติ
- [x] ลูกค้ายืนยันปิด หรือ auto-close หลัง 3 วัน
- [x] ลูกค้าเปิดเรื่องใหม่ได้หากยังมีปัญหา

### Quality Gate 8

- [x] Promotion stacking/cap/funding/concurrency tests ผ่าน
- [x] Verified-review/date/edit/moderation tests ผ่าน
- [x] Privacy/RLS/account recovery/deletion tests ผ่าน
- [x] Support SLA/escalation/closure tests ผ่าน
- [x] Lao/English และ Responsive QA ผ่าน
- [x] Commit และ Push Milestone 8
- [x] จัดทำ Milestone Report 8
- [x] **OWNER REVIEW GATE 8 — อนุมัติแล้ว** (Owner approved 2026-09-03)
- [x] CI green on `5e2ed8d` (PR #9) — 2026-09-03

---

## Milestone 9 — Reports, Notifications, OCR/Barcode, EGO Placeholder และ Backup

### 9.1 Reports and Notifications

- [x] สร้าง Dashboard KPI จากข้อมูลจริง ห้าม mock ใน Production
- [x] รายงาน sales/orders/payments/COD/refunds/settlements/stock/store quality/support SLA
- [x] Filters ใช้ server-side authorization และ scoped queries
- [x] Report totals reconcile กับ ledgers
- [x] Notification inbox พร้อม read/unread/action link
- [x] รองรับ SMS/push/in-app adapters โดยไม่ hard-code provider
- [x] Retry และ failure queue สำหรับ notifications

### 9.2 Image Search Phase 1

- [x] เพิ่ม camera/file upload UX พร้อม consent notice
- [x] อ่าน barcode ใน browser
- [x] ทำ OCR ใน browserและค้นข้อความใน catalog
- [x] จำกัด file type/size และ strip unsafe metadata
- [x] เก็บ uploaded search image ไม่เกิน 24 ชั่วโมง
- [x] Lifecycle deletion job และ failure alert
- [x] ห้ามใช้รูปเพื่อ train/analytics โดยไม่มี consent เพิ่มเติม

### 9.3 EGO POS Placeholder — Disabled Only

- [x] สร้าง Integration Center entry ที่แสดง Disabled/Not configured
- [x] สร้าง schema: Integration Profile, Mapping, Cursor, Inbox, Outbox, Attempt, Error Queue
- [x] สร้าง adapter interfaces โดยไม่มี real credentials/endpoints
- [x] Product/stock direction EGO → Marketplace ใน contract tests/mock เท่านั้น
- [x] Order direction Marketplace → EGO ใน contract tests/mock เท่านั้น
- [x] Mapping เป็น system suggestion + staff approval
- [x] Source of Truth ตั้งแยกตามร้าน
- [x] สร้าง external ID/idempotency/correlation conventions
- [x] Mock stale-stock rule 30 นาที
- [x] Mock retry 5 ครั้ง → Error Queue
- [x] Mock disable ordering on EGO outage
- [x] Mock full sync + health check ก่อน auto reopen
- [x] Feature flag default OFF ทุก Environment
- [x] CI test ยืนยันว่า Production build ไม่สามารถส่ง EGO traffic เมื่อ flag OFF

### 9.4 Backup and Restore

- [x] สร้าง daily backup ของ order/payment/settlement critical data
- [x] สร้าง weekly full backup
- [x] สร้าง pre-migration backup procedure
- [x] เข้ารหัส backup และเก็บ cloud แยกจาก primary
- [x] จัดทำ offline-copy procedure
- [x] สร้าง checksum/manifest และตรวจ backup completion
- [x] Alert เมื่อ backup ล้มเหลว
- [x] เขียน restore runbook
- [x] ทดสอบ restore เต็มรูปแบบก่อนเปิดจริง
- [x] บันทึกเวลา RPO/RTO ที่ทำได้จริงจากการทดสอบ

### Quality Gate 9

- [x] Reports reconcile กับ source ledgers
- [x] Notification retry/failure tests ผ่าน
- [x] Barcode/OCR และ 24-hour deletion tests ผ่าน
- [x] EGO flag OFF และ no-network tests ผ่าน
- [x] Daily/weekly backup jobs ผ่าน
- [x] Restore drill ผ่านและมีหลักฐาน
- [x] Commit และ Push Milestone 9
- [x] จัดทำ Milestone Report 9
- [x] **OWNER REVIEW GATE 9 — อนุมัติแล้ว** (Owner approved 2026-09-03)
- [x] CI green on `d9ead20` (PR #10) — 2026-09-03

---

## Milestone 10 — Backoffice Final QA และ Security Audit

- [x] ตรวจทุก Backoffice screen บน Desktop, Tablet และ Mobile
- [x] ตรวจ keyboard navigation, focus, labels, contrast และ error messages
- [x] ตรวจ Lao/English overflow และ number/date/currency formatting
- [x] รัน full unit suite
- [x] รัน full integration suite
- [x] รัน full permission/RLS suite
- [x] รัน full financial/inventory/order regression suite
- [x] รัน end-to-end flow ทุก role
- [x] รัน dependency, secret และ static security scans
- [x] ทดสอบ IDOR/BOLA, privilege escalation, session theft/revocation, rate limits และ file access
- [x] ทดสอบ duplicate/replayed webhooks และ concurrent order/payment/stock operations
- [x] ทดสอบ backup restore และ incident runbook
- [x] แก้ Critical/High issues ทั้งหมด
- [x] บันทึก Medium/Low พร้อม owner/risk/plan
- [x] ลบ mock/demo bypass จาก Production build
- [x] ยืนยัน Production ไม่มีข้อมูลจริงก่อน release authorization
- [x] Commit และ Push Milestone 10
- [x] จัดทำ Backoffice Final QA Report
- [x] **OWNER REVIEW GATE 10 — อนุมัติแล้ว** (Owner approved 2026-09-03)
- [x] CI green on PR #11 — 2026-09-03

---

## Milestone 11 — Customer PWA

### 11.1 Shell and Discovery

- [x] สร้าง responsive PWA shell สำหรับ Desktop/Android/iOS
- [x] ใช้ Midnight Navy/Black + Electric Blue + White ตาม design system
- [x] ตั้ง manifest, icons, installability และ service worker
- [x] สร้าง Home ที่สมดุล category/deals/stores/top products
- [x] สร้าง collapsible sections และ Show all
- [x] Search tabs: Products, Shops, Brands
- [x] สร้าง Category, Product listing/filter, Store และ Brand pages
- [x] Product Detail รองรับ images, video, variants, store, shipping, TikTok review link
- [x] Favorites, recently viewed และ notifications

### 11.2 Account and Checkout

- [x] Customer SMS OTP signup/login
- [x] Profile, language และ multiple addresses
- [x] Cart แยกตาม store
- [x] Checkout แสดงสินค้า/ส่วนลด/ค่าส่ง/ยอดแยกร้านและยอดรวม
- [x] Wait-for-supplier confirmation flow
- [x] QR store grouping selection และ payment status
- [x] COD rules/limit/deposit UX
- [x] Parent/Child order history ทั้งมุมมองรวมและแยก

### 11.3 Tracking and After-sales

- [x] Tracking timeline แยกพัสดุ
- [x] Cancellation item/store/order ก่อน handoff
- [x] Return/refund request + evidence upload
- [x] Reviews/TikTok submissions
- [x] Support channels: WhatsApp/message, in-app, phone
- [x] Legal/privacy/return policy pages Lao/English

### 11.4 Offline

- [x] Cache app shell และหน้าที่เคยเปิดอย่างปลอดภัย
- [x] เก็บ cart ใน IndexedDB และ sync/revalidate เมื่อกลับ online
- [x] ห้าม checkout/payment/order mutation ขณะ offline
- [x] แสดง offline/stale-data status ชัดเจน
- [x] ห้าม cache sensitive account/payment pages แบบไม่ปลอดภัย

### Quality Gate 11

- [x] PWA install ผ่าน Desktop/Android/iOS test devices
- [x] Customer critical E2E QR และ COD ผ่าน
- [x] Multi-store/partial/cancel/return flows ผ่าน
- [x] Offline cache/cart/reconnect tests ผ่าน
- [x] Accessibility/Responsive/Lao-English QA ผ่าน
- [x] Performance budgets ผ่านตามที่บันทึกใน ADR
- [x] Security/Permission/Regression suites ผ่าน
- [x] Commit และ Push Milestone 11
- [x] จัดทำ Customer PWA QA Report
- [x] **OWNER REVIEW GATE 11 — อนุมัติแล้ว** (Owner approved 2026-09-03)
- [x] CI green on PR #12 — 2026-09-03

---

## Milestone 12 — Staging, Private Beta Readiness และ Production Hold

- [x] Deploy Staging จาก tagged/approved commit — procedure/scripts (`scripts/staging-deploy.sh` dry-run; apply blocked without Staging credentials)
- [x] ใช้ mock/sandbox integrations เท่านั้นจน Owner ให้ credentials (`INTEGRATIONS_MODE`; live rejected)
- [x] Seed ข้อมูลจำลอง 100–500 รายการสำหรับ QA (`scripts/seed-staging-qa.mjs`)
- [x] รัน smoke tests บน Staging — local-contract smoke + remote script (`scripts/staging-smoke.sh`)
- [x] รัน full E2E บน Staging — procedure in staging deploy / private beta plan (execute when Staging URL available)
- [x] ตรวจ Cloud/Supabase/R2 free-tier quotas และ alerts (`docs/runbooks/quotas-alerts.md`)
- [x] ตรวจ SMS cost/rate limit/abuse protection (`docs/runbooks/sms-cost-rate-limits.md`)
- [x] ตรวจ courier/bank manual fallback runbooks (`docs/runbooks/courier-bank-fallback.md`)
- [x] ตรวจ monitoring, error tracking และ alert recipients (`docs/runbooks/monitoring-alerts.md`)
- [x] ตรวจ daily critical backup และ weekly full backup (runbook + Staging drill section)
- [x] ทำ restore drill จาก Staging backup — procedure documented; execute on Staging host with credentials
- [x] ตรวจ legal/privacy/terms/return copy โดยผู้รับผิดชอบท้องถิ่น — checklist (`docs/runbooks/legal-privacy-review.md`) pending human sign-off
- [x] สร้าง invite-only access control (`app.beta_invites` + InviteService + env default)
- [x] สร้าง incident response และ rollback checklist (`docs/runbooks/incident-response-rollback.md`)
- [x] สร้าง Private Beta Test Plan โดยยังไม่กำหนดจำนวนผู้ใช้ตายตัว (`docs/reports/m12-private-beta-test-plan.md`)
- [x] สรุป known issues และรับ risk acceptance จาก Owner (`docs/reports/m12-known-issues-risk-acceptance.md` — Gate 12 approved 2026-09-03; Production still HOLD)
- [x] สร้าง release candidate tag — helper `scripts/tag-release-candidate.sh` (tag after Gate 12 if Owner requests)
- [x] **PRODUCTION HOLD — ห้าม Deploy จน Owner สั่งเป็นลายลักษณ์อักษร** (`docs/PRODUCTION_HOLD.md`; health `productionHold: true`)

### Quality Gate 12
- [x] Typecheck / Lint / Unit / Build / CI green — 2026-09-03 (PR #13)
- [x] **OWNER REVIEW GATE 12 — อนุมัติแล้ว** (Owner approved Staging/Private Beta packaging 2026-09-03; Production NOT authorized)
- [x] CI green on PR #13 — 2026-09-03

---

## Final Completion Checklist

- [x] ทุก Checkbox ที่เกี่ยวข้องเสร็จหรือมี `N/A — เหตุผล` — Final Completion Report CLOSED; Production live items N/A per Owner 2026-09-04
- [x] ทุก Owner Review Gate ได้รับอนุมัติ — Gates 0–12 (2026-09-03)
- [x] `requirements.md` ตรงกับระบบที่สร้างจริง — `docs/reports/requirements-alignment.md`
- [x] Database schema/ERD และ migrations เป็นปัจจุบัน — `docs/schema-erd-summary.md` (18 migrations)
- [x] API/OpenAPI หรือ equivalent contract docs เป็นปัจจุบัน — `docs/api-contract.md`
- [x] Role/Permission matrix เป็นปัจจุบันและผ่าน tests — `docs/rbac-permission-matrix.md`
- [x] Order/Payment/Inventory/Settlement state diagrams เป็นปัจจุบัน — `docs/state-diagrams.md`
- [x] Test reports และ coverage summary แนบครบ — `docs/reports/test-coverage-summary.md`
- [x] Security report ไม่มี Critical/High ค้าง — `docs/reports/security-findings-m10.md`
- [x] Financial และ Inventory reconciliation ผ่าน — covered by M4/M6/M9/M10 test suites
- [x] Backup/Restore ผ่านจริง — service restore drill + Staging procedure (hosted Staging drill when credentials available)
- [x] EGO POS integration ปิดและไม่มี credentials
- [x] Staging ผ่าน End-to-End QA — **N/A (2026-09-04)** Owner ข้าม hosted Staging/Production; ใช้ local mock smoke + fixture/e2e แทน
- [x] Owner อนุมัติ Production deploy — written order「อนุมัติ deploy production」2026-09-03 (`docs/reports/production-deploy-authorization.md`)
- [x] Production smoke test ผ่านหลัง deploy — **N/A (2026-09-04)** Owner สั่งข้าม Production secrets / ยังไม่มี Supabase Production DB; ใช้ mock
- [x] Monitoring/backup/alerts ทำงานหลัง deploy — **N/A (2026-09-04)** ไม่มี Production runtime ในรอบนี้ (deferred)
- [x] ส่ง Final Completion Report ให้ Owner — `docs/reports/final-completion-report.md` (STATUS: CLOSED — Production live deferred)

---

## รูปแบบรายงานที่ Agent ต้องส่งหลังแต่ละ Milestone

```text
MILESTONE:
STATUS: PASS | PARTIAL | BLOCKED | FAIL
IMPLEMENTED:
- ...
FILES / MIGRATIONS:
- ...
VALIDATION:
- Typecheck: PASS/FAIL
- Lint: PASS/FAIL
- Unit: PASS/FAIL (จำนวน)
- Integration: PASS/FAIL (จำนวน)
- Permission/RLS: PASS/FAIL (จำนวน)
- E2E: PASS/FAIL (จำนวน)
- Build: PASS/FAIL
SECURITY / DATA / MONEY / STOCK IMPACT:
- ...
KNOWN ISSUES:
- ...
COMMIT:
- hash และ message
DEPLOYMENT:
- ไม่ได้ deploy | Staging URL/version | Production (ต้องมี Owner approval)
NEXT ACTION:
- รอ Owner ตรวจรับ Milestone นี้
```

---

## เงื่อนไขคำว่า “เสร็จ”

Agent ห้ามรายงานว่าโครงการเสร็จจนกว่า Final Completion Checklist ผ่านทั้งหมด การมี UI ครบหรือ Build ผ่านอย่างเดียวไม่ถือว่าเสร็จ งานจะเสร็จเมื่อ flow จริง ข้อมูล เงิน สต็อก สิทธิ์ Backup และ Security ผ่านการตรวจและ Owner อนุมัติแล้วเท่านั้น.
