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
- [x] N/A — เปิด branch protection สำหรับ `main` — Agent token ได้ 403; Owner ต้องเปิดใน GitHub settings
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
- [ ] CI ผ่านทุก job — รอผลหลัง Push
- [x] Commit และ Push Milestone 0 — `e34ff375` / branch `cursor/milestone-0-foundation-35e5` / PR #1
- [x] จัดทำ Milestone Report 0 — `docs/reports/milestone-0.md`
- [ ] **OWNER REVIEW GATE 0 — หยุดรอการตรวจรับ**

---

## Milestone 1 — Database, Authentication, Roles, 2FA และ Audit

### 1.1 Supabase/PostgreSQL Foundation

- [ ] สร้าง Supabase projects/config แยก Local, Staging, Production
- [ ] ห้ามใส่ Production credentials ใน Local/Staging
- [ ] สร้าง migration framework และ naming convention
- [ ] สร้าง private schemas สำหรับ internal/financial/security data
- [ ] เปิด RLS บนทุก table ใน exposed schema
- [ ] กำหนด grants อย่างชัดเจน; ห้ามพึ่ง default grants
- [ ] สร้าง UUID/ID strategy, timestamps และ soft/archive policy
- [ ] เก็บเวลา UTC และกำหนด timezone display เป็น Laos
- [ ] กำหนดเงิน LAK เป็น integer หน่วยกีบ
- [ ] เพิ่ม database constraints และ indexes สำหรับ foreign keys/status/lookups

### 1.2 Identity and Sessions

- [ ] สร้าง customer profile แยกจาก auth identity
- [ ] บังคับหนึ่งเบอร์โทรต่อหนึ่งบัญชี
- [ ] เชื่อม SMS OTP provider ผ่าน abstraction; รองรับ mock provider เฉพาะ Local/Test
- [ ] เพิ่ม OTP rate limit, cooldown, expiry และ anti-enumeration response
- [ ] เพิ่ม CAPTCHA/risk control สำหรับ OTP abuse
- [ ] สร้าง staff profile และ staff status
- [ ] บังคับ OTP เมื่อ staff login จากอุปกรณ์ใหม่
- [ ] แจ้ง Owner เมื่อมีอุปกรณ์ใหม่
- [ ] ออกจาก Backoffice หลัง idle 1 ชั่วโมง
- [ ] นับ login/OTP failures อย่างปลอดภัย
- [ ] ล็อกบัญชีเมื่อผิด 5 ครั้ง
- [ ] Admin ปลดล็อก staff ได้แต่ห้ามปลดล็อกตนเอง
- [ ] Owner เป็นผู้ปลดล็อก Admin
- [ ] สร้าง Owner recovery process แบบ audited
- [ ] สร้าง session/device list และ Sign out all sessions
- [ ] รองรับหลายอุปกรณ์และแจ้งทุก session ใหม่

### 1.3 Roles and Permissions

- [ ] สร้างมาตรฐาน Owner, Admin, Finance, Operations, Catalog, Support, Auditor
- [ ] สร้าง permission catalog แบบ granular
- [ ] รองรับ role defaults และ per-user overrides
- [ ] เก็บ authorization claims ใน trusted server/app metadata เท่านั้น
- [ ] Server ตรวจสิทธิ์ทุก action; ห้ามพึ่งการซ่อนปุ่มใน UI
- [ ] สร้าง maker-checker policy engine
- [ ] ห้ามผู้สร้างอนุมัติรายการตนเอง
- [ ] การเปลี่ยนสิทธิ์ Finance/Admin ต้อง Owner + 2FA
- [ ] รองรับ Owner delegation ให้ Admin แยกตาม approval type
- [ ] Delegated Admin ใช้ 2FA ทุก high-risk approval
- [ ] แสดง active delegation banner
- [ ] ส่ง daily delegation summary ให้ Owner
- [ ] Owner revoke delegation ได้ทันที

### 1.4 Audit and Export Security

- [ ] สร้าง append-only audit events พร้อม actor, action, target, before/after, reason, IP/device, correlation ID และ timestamp
- [ ] ป้องกัน application roles แก้หรือลบ Audit Log
- [ ] ตั้ง retention Audit Log 5 ปี
- [ ] Log การเปิดดูข้อมูลลูกค้าที่สำคัญ
- [ ] สร้าง export request + approval workflow
- [ ] บังคับเหตุผลในการ export
- [ ] สร้าง encrypted export file พร้อม expiry และ download limit
- [ ] Log การสร้าง อนุมัติ ดาวน์โหลด หมดอายุ และลบ export

### 1.5 Tests

- [ ] Unit test permission evaluator
- [ ] Unit test maker-checker/self-approval rejection
- [ ] Integration test OTP rate limits/lockout
- [ ] Integration test session expiry/device notification
- [ ] RLS tests ทุก role และ cross-user/cross-store denial
- [ ] Test service-role/secret ไม่ปรากฏใน client bundle
- [ ] Test Audit Log เขียนได้แต่แก้/ลบไม่ได้จาก app roles
- [ ] Test export approval และ expired link rejection

### Quality Gate 1

- [ ] Login/OTP/2FA happy path ผ่าน
- [ ] Invalid/expired/replayed OTP ถูกปฏิเสธ
- [ ] Role matrix tests ผ่านทั้งหมด
- [ ] ไม่มี BOLA/IDOR จาก RLS/API tests
- [ ] Security scan ไม่มี Critical/High ที่ยังไม่แก้
- [ ] Responsive Backoffice shell ผ่าน Desktop/Tablet/Mobile
- [ ] Commit และ Push Milestone 1
- [ ] จัดทำ Milestone Report 1
- [ ] **OWNER REVIEW GATE 1 — หยุดรอการตรวจรับ**

---

## Milestone 2 — Store, Contract, Payout และ Fulfillment

### 2.1 Store Domain

- [ ] สร้าง Store, Store Contact, Store Status และ Store Risk Profile
- [ ] สร้าง Fulfillment Location แบบหลายจุดใน schema
- [ ] จำกัด Phase 1 ให้เปิดใช้งานหนึ่งจุดต่อร้านใน business rule
- [ ] สร้าง store onboarding checklist
- [ ] บังคับบัตรเจ้าของร้าน ข้อมูลร้าน บัญชีธนาคาร และสัญญาก่อนเปิดขาย
- [ ] เก็บเอกสารใน private storage พร้อม signed access
- [ ] จำกัดและ Audit ผู้เปิดดูเอกสาร
- [ ] ติดตาม document expiry และแจ้งล่วงหน้า
- [ ] ระงับร้านอัตโนมัติเมื่อเอกสารหมดอายุ

### 2.2 Contract Versioning

- [ ] สร้าง immutable Contract Version พร้อม effective date
- [ ] รองรับ markup, commission, per-order fee และ mixed model
- [ ] รองรับ settlement cadence รายวัน รายสัปดาห์ รายเดือน กำหนดเอง
- [ ] Contract ใหม่มีผลเฉพาะออเดอร์ใหม่ตาม effective date
- [ ] Snapshot contract terms ลง Child Order
- [ ] ห้ามคำนวณออเดอร์เดิมย้อนหลังจาก Contract ใหม่

### 2.3 Payout Account

- [ ] จำกัดหนึ่ง active payout account ต่อร้าน
- [ ] เก็บ payout account version history ห้ามแก้ทับ
- [ ] Finance สร้างคำขอเปลี่ยนบัญชี
- [ ] Owner อนุมัติด้วย 2FA
- [ ] พัก payout 48 ชั่วโมงหลังเปลี่ยนบัญชี
- [ ] Settlement อ้างอิง payout account version ที่ใช้จริง
- [ ] Alert Owner เมื่อบัญชีรับเงินเปลี่ยน

### 2.4 Store Suspension

- [ ] สร้าง rolling 30-day quality counters
- [ ] ระงับเมื่อตอบ/แพ็กช้า 5 ครั้ง
- [ ] ระงับเมื่อ stock mismatch 3 ครั้ง
- [ ] ระงับเมื่อส่งผิด/เสีย/ไม่ตรงรายละเอียด 3 ครั้ง
- [ ] รองรับ immediate suspension สำหรับ fraud/security
- [ ] ร้านระงับยังแสดงสินค้าแต่ซื้อไม่ได้
- [ ] ออเดอร์เดิมอยู่ภายใต้ staff review
- [ ] Owner/Admin reactivate พร้อม corrective-action evidence
- [ ] Audit suspend/reactivate ทุกครั้ง

### Quality Gate 2

- [ ] Store เปิดขายไม่ได้เมื่อเอกสารไม่ครบ/หมดอายุ
- [ ] Contract snapshot และ effective-date tests ผ่าน
- [ ] Payout maker-checker/2FA/48-hour hold tests ผ่าน
- [ ] Quality threshold และ suspension tests ผ่าน
- [ ] Permission/Responsive/Regression tests ผ่าน
- [ ] Commit และ Push Milestone 2
- [ ] จัดทำ Milestone Report 2
- [ ] **OWNER REVIEW GATE 2 — หยุดรอการตรวจรับ**

---

## Milestone 3 — Product, Variant, Media, Brand และ Price Approval

### 3.1 Catalog

- [ ] สร้าง Category hierarchy และ translations Lao/English
- [ ] สร้าง Brand พร้อม verification evidence
- [ ] สร้าง Product แยกตาม Store
- [ ] สร้าง Product Variant พร้อม SKU, barcode, attributes, price และ status
- [ ] บังคับ SKU unique ภายในร้าน
- [ ] อนุญาต barcode ซ้ำข้ามร้านและสร้าง duplicate alert
- [ ] สร้าง Store Product ID สำหรับ future integration mapping
- [ ] รองรับ draft, pending approval, active, paused, archived
- [ ] สร้าง bulk import CSV/XLSX validation + preview + error report
- [ ] Import ต้อง idempotent และ rollback batch ที่ผิดร้ายแรง

### 3.2 Media and Content

- [ ] รองรับรูปหลายรูปต่อ Product/Variant
- [ ] รองรับวิดีโอสินค้าโดยกำหนด type/size/duration limits
- [ ] สร้าง private upload flow และ malware/content validation ตามความเหมาะสม
- [ ] สร้าง image processing/thumbnail pipeline
- [ ] รองรับ Lao/English title, description, specifications และ warnings
- [ ] บังคับวันผลิต วันหมดอายุ ส่วนประกอบ และคำเตือนสำหรับสินค้ามีอายุ
- [ ] บังคับหลักฐานก่อนใช้คำว่าแบรนด์แท้
- [ ] ปิดหมวดยา อาวุธ บุหรี่ แอลกอฮอล์ และสินค้าผิดกฎหมาย

### 3.3 Pricing

- [ ] เก็บ cost, selling price, compare-at price และ margin เป็น integer LAK
- [ ] ทุก price change สร้าง approval request
- [ ] ห้ามใช้ราคาใหม่ก่อนอนุมัติ
- [ ] Below-cost ต้อง Owner approval + 2FA + reason
- [ ] เก็บ Price Version history ห้ามแก้ทับ
- [ ] Product Detail ใช้ active approved price เท่านั้น
- [ ] สร้างใกล้หมดอายุ discount request; ห้ามลดอัตโนมัติโดยไม่อนุมัติ

### Quality Gate 3

- [ ] CRUD/archive Product/Variant ผ่าน
- [ ] Import valid/invalid/duplicate/retry tests ผ่าน
- [ ] Media permissions และ signed URL tests ผ่าน
- [ ] Price approval/below-cost/self-approval denial tests ผ่าน
- [ ] Lao/English rendering และ responsive QA ผ่าน
- [ ] Commit และ Push Milestone 3
- [ ] จัดทำ Milestone Report 3
- [ ] **OWNER REVIEW GATE 3 — หยุดรอการตรวจรับ**

---

## Milestone 4 — Inventory, Lot, Reservation และ Stock Audit

### 4.1 Inventory Ledger

- [ ] สร้าง Inventory Balance ต่อ Store/Location/Variant/Lot
- [ ] สร้าง append-only Inventory Transactions
- [ ] คำนวณ Available = On hand − Reserved − Safety buffer
- [ ] กำหนด Safety buffer แยกสินค้าและร้าน
- [ ] ห้าม transaction ทำให้ stock ติดลบ
- [ ] Alert ทีมงานเมื่อ operation ถูกปฏิเสธเพราะ stock ไม่พอ
- [ ] รองรับ adjustment พร้อม reason/approval ตามสิทธิ์
- [ ] รองรับ stock import preview และ reconciliation
- [ ] สร้าง stock verification due ทุก 3 วัน

### 4.2 Lot and Expiry

- [ ] บังคับ Lot/production/expiry สำหรับอาหาร เครื่องสำอาง และสินค้ามีอายุ
- [ ] Default minimum remaining shelf life 90 วัน
- [ ] รองรับ minimum shelf life แยกตามประเภทสินค้าอายุสั้น
- [ ] Alert เมื่อเข้าใกล้ minimum threshold
- [ ] สร้าง discount approval request จาก expiry alert
- [ ] ห้าม allocate expired/blocked/recall lot

### 4.3 Reservation

- [ ] จองสต็อกเมื่อร้านยืนยันว่ามีสินค้า
- [ ] QR reservation หมดอายุ payment deadline + 30 นาที
- [ ] COD reservation ต่อถึง delivered/cancelled/released
- [ ] ปล่อย reservation แบบ idempotent
- [ ] ป้องกัน double reservation จาก concurrent requests
- [ ] สร้าง reconciliation job ตรวจ balance กับ transaction ledger

### Quality Gate 4

- [ ] Concurrency/oversell tests ผ่าน
- [ ] Negative-stock constraints ผ่าน
- [ ] Reservation expiry/release/retry tests ผ่าน
- [ ] Lot/expiry allocation tests ผ่าน
- [ ] Ledger reconciliation ได้ศูนย์ difference ใน fixtures
- [ ] Permission/Responsive/Regression tests ผ่าน
- [ ] Commit และ Push Milestone 4
- [ ] จัดทำ Milestone Report 4
- [ ] **OWNER REVIEW GATE 4 — หยุดรอการตรวจรับ**

---

## Milestone 5 — Parent/Child Order และ State Machine

### 5.1 Order Creation

- [ ] สร้าง Cart แยกรายการตาม Store
- [ ] Server revalidate product status, price, promo, stock และ shipping ก่อนสร้าง order
- [ ] สร้าง Parent Order หนึ่งรายการต่อ checkout
- [ ] สร้าง Child Order หนึ่งรายการต่อร้าน
- [ ] สร้าง immutable Order Item snapshots
- [ ] สร้างเลขออเดอร์หลักและเลขย่อยร้านแบบ unique
- [ ] รองรับดูรวมและดูแยกตามร้าน
- [ ] สร้าง combined summary และ store-level documents

### 5.2 State Machine

- [ ] Implement allowed transitions เท่านั้น
- [ ] รองรับ pending supplier, confirmed, partial confirmed, awaiting payment/COD, packing, ready, handed to courier, in transit, delivered
- [ ] รองรับ partial cancelled, cancelled, delivery failed, return requested, refunded
- [ ] Parent status derive จาก Child statuses
- [ ] Mixed delivered/cancelled แสดง completed พร้อม cancellation note
- [ ] Transition ทุกครั้งต้องมี actor, reason, timestamp และ audit event
- [ ] ป้องกัน out-of-order/replayed transition

### 5.3 Cancellation and Split Shipment

- [ ] ลูกค้ายกเลิกระดับ item/store/order ก่อน courier handoff
- [ ] หลัง handoff เปลี่ยนเป็น refusal/return workflow
- [ ] Recalculate promotion เมื่อยกเลิกบางรายการ
- [ ] แสดงยอด/ส่วนลดที่เปลี่ยนก่อนลูกค้ายืนยัน
- [ ] หลังจ่าย QR สร้าง refund request แทนการแก้ payment
- [ ] Split shipment ต่อร้านต้อง Admin approval
- [ ] Shipment ทุกใบอ้าง Child Order และ items ที่อยู่ในพัสดุ

### Quality Gate 5

- [ ] Multi-store creation atomicity tests ผ่าน
- [ ] Order snapshot immutability tests ผ่าน
- [ ] State transition matrix tests ผ่านทุก allowed/forbidden path
- [ ] Partial cancel/promo recalculation tests ผ่าน
- [ ] Split shipment approval tests ผ่าน
- [ ] Permission/Responsive/Regression tests ผ่าน
- [ ] Commit และ Push Milestone 5
- [ ] จัดทำ Milestone Report 5
- [ ] **OWNER REVIEW GATE 5 — หยุดรอการตรวจรับ**

---

## Milestone 6 — QR, COD, Payment Ledger และ Reconciliation

### 6.1 Payment Ledger

- [ ] สร้าง Payment Request, Payment Attempt, Receipt, Allocation, Refund และ Adjustment
- [ ] ห้ามแก้ ledger rows ย้อนหลัง
- [ ] ใช้ idempotency key กับ manual/API payment confirmation
- [ ] สร้าง unique bank/courier reference constraints
- [ ] แยก delivered status ออกจาก money-received status
- [ ] สร้าง daily reconciliation views/jobs

### 6.2 QR Flow

- [ ] แสดง QR หลัง supplier confirmation เท่านั้น
- [ ] ลูกค้าเลือก confirmed stores ที่จะรวมใน QR ได้
- [ ] สร้าง Allocation ต่อ Child Order ให้รวมตรง Payment Request
- [ ] Deadline ภายในวันเดียวกันและอย่างน้อย 2 ชั่วโมง
- [ ] QR expired ต้องหยุดรับและจัดการ reservation ตามกฎ
- [ ] รองรับ manual verification และ Bank API adapter
- [ ] รูปหลักฐานอยู่ pending จนยืนยันเงินจริง
- [ ] Overpayment สร้าง excess refund request
- [ ] Underpayment สร้าง QR เฉพาะยอดขาดและ link attempt เดิม

### 6.3 COD Flow

- [ ] COD แยกยอดตามพัสดุ
- [ ] ลูกค้าใหม่ limit 500,000 LAK
- [ ] ตั้งแต่ 300,000 LAK ต้อง phone verification + 30% deposit
- [ ] Deposit หักจาก COD balance อย่างถูกต้อง
- [ ] นับ customer-caused failed deliveries เท่านั้น
- [ ] Failed COD 2 ครั้งบังคับ QR
- [ ] Staff restore COD พร้อม reason/audit
- [ ] Redelivery จากติดต่อไม่ได้ต้องชำระค่าส่งก่อน
- [ ] Courier remittance แยกจาก delivery proof

### 6.4 Reconciliation

- [ ] Reconcile bank receipts กับ Payment Requests/Allocations
- [ ] Reconcile COD collections กับ courier remittance
- [ ] สร้าง mismatch queue และ Finance resolution workflow
- [ ] Adjustment ต้อง approval และไม่แก้ source ledger
- [ ] Daily totals ต้องพิสูจน์ได้ถึง child/item level

### Quality Gate 6

- [ ] QR combined allocation/partial/over/under/expiry tests ผ่าน
- [ ] Duplicate webhook/manual confirmation ไม่สร้างเงินซ้ำ
- [ ] COD limit/deposit/failure/remittance tests ผ่าน
- [ ] Reconciliation fixtures ไม่มี unexplained difference
- [ ] Permission/Security/Regression tests ผ่าน
- [ ] Commit และ Push Milestone 6
- [ ] จัดทำ Milestone Report 6
- [ ] **OWNER REVIEW GATE 6 — หยุดรอการตรวจรับ**

---

## Milestone 7 — Delivery, Return, Refund, Recall และ Settlement

### 7.1 Delivery

- [ ] สร้าง Courier และ Courier Contract configuration
- [ ] รองรับ manual shipment และ API adapter
- [ ] เก็บรูปพัสดุ tracking number และ handoff timestamp
- [ ] รองรับ Proof of Delivery หลายวิธีตามบริษัท
- [ ] เก็บ liability/compensation rules แยก courier
- [ ] Supplier ต้องแพ็กภายใน 24 ชั่วโมงหลังยืนยัน
- [ ] สร้าง late packing alert/counter
- [ ] Lost/damaged claim workflow และ platform coordination

### 7.2 Returns and Refunds

- [ ] Return request ภายใน 7 วันหลัง delivery
- [ ] อนุญาต defective/wrong/incomplete/materially not described เท่านั้น
- [ ] ปฏิเสธ change-of-mind reason
- [ ] กำหนด return shipping liability ตาม cause
- [ ] Refund ทุกจำนวนต้อง approval
- [ ] Refund SLA 7 business days หลัง approval
- [ ] Preserve evidence, communications และ audit trail
- [ ] Refund update ledger ผ่าน refund/reversal records เท่านั้น

### 7.3 Recall

- [ ] Recall action ปิดขาย Product/Lot ทันที
- [ ] ระบุ affected orders/customers อย่างตรวจสอบได้
- [ ] ทีมงานและร้านประสานลูกค้าร่วมกัน
- [ ] ร้านรับผิดชอบค่าใช้จ่ายตามกฎ
- [ ] ติดตาม contact/refund/replacement จนครบทุก affected order

### 7.4 Settlement

- [ ] สร้าง Settlement eligibility หลัง delivered + platform received money
- [ ] ใช้ cadence จาก Contract snapshot
- [ ] Finance hold item/child ตามกรณี return
- [ ] สร้าง settlement batch และ line items ที่ trace ถึง order/payment
- [ ] Maker และ Approver ต้องคนละคน
- [ ] จ่ายเข้า Payout Account Version ที่อนุมัติ
- [ ] รองรับ negative balance carry-forward และ collection request
- [ ] ร้าน dispute ได้ภายใน 7 วัน
- [ ] พักเฉพาะยอดที่ disputed

### Quality Gate 7

- [ ] Delivery manual/API adapter contract tests ผ่าน
- [ ] Return eligibility/liability/refund SLA tests ผ่าน
- [ ] Recall affected-order completeness test ผ่าน
- [ ] Settlement eligibility/maker-checker/dispute/negative tests ผ่าน
- [ ] Financial ledger reconciliation ผ่าน
- [ ] Permission/Responsive/Regression tests ผ่าน
- [ ] Commit และ Push Milestone 7
- [ ] จัดทำ Milestone Report 7
- [ ] **OWNER REVIEW GATE 7 — หยุดรอการตรวจรับ**

---

## Milestone 8 — Promotions, Content, Reviews, TikTok, Customers และ Support

### 8.1 Promotions

- [ ] สร้าง promotion rules/conditions/scopes/budget/quantity/effective dates
- [ ] รองรับ stacking ตาม Admin rules
- [ ] รองรับ platform-funded, supplier-funded และ percentage split
- [ ] Snapshot applied promotion ลง order
- [ ] Alert budget/quantity ที่ 80% และ 90%
- [ ] Hard stop ที่ cap; ป้องกัน concurrency overspend
- [ ] Recalculate เมื่อ cancel items

### 8.2 Reviews and TikTok

- [ ] รีวิวได้เฉพาะ delivered verified purchase
- [ ] เขียนได้ภายใน 30 วัน
- [ ] แก้ได้ภายใน 7 วันและเก็บ version history
- [ ] Supplier response ต้อง approval ก่อนแสดง
- [ ] Staff publish TikTok link ได้
- [ ] Supplier/customer submissions เข้า moderation queue
- [ ] Suspicious content ซ่อนชั่วคราวและแจ้ง Admin
- [ ] ตรวจ URL allowlist/protocol และป้องกัน malicious redirect

### 8.3 Customers and Privacy

- [ ] รองรับหลาย address และ default address
- [ ] รองรับ recipient name/phone แยกจาก account
- [ ] Order address เป็น immutable snapshot
- [ ] เปลี่ยนเบอร์ต้อง OTP เบอร์เดิมและใหม่
- [ ] ไม่มีเบอร์เดิมใช้ document-based recovery
- [ ] เอกสาร recovery encrypted/private/audited
- [ ] Account deletion request ใช้ OTP + staff approval
- [ ] Anonymize ข้อมูลที่ไม่จำเป็นแต่รักษา records ที่ต้องเก็บ
- [ ] Marketing เปิดเริ่มต้นพร้อม notice ชัดเจนและ opt-out ง่าย
- [ ] ร้านเห็นเฉพาะข้อมูลที่จำเป็นต่อ delivery

### 8.4 Support

- [ ] รองรับ in-app chat/ticket, WhatsApp/message reference และ phone logs
- [ ] First response ภายในวันเดียวกัน
- [ ] Urgent case ส่ง Team Lead + Finance ทันที
- [ ] Urgent preliminary resolution ภายใน 3 business days
- [ ] General resolution ภายใน 7 business days
- [ ] SLA breach escalate Team Lead อัตโนมัติ
- [ ] ลูกค้ายืนยันปิด หรือ auto-close หลัง 3 วัน
- [ ] ลูกค้าเปิดเรื่องใหม่ได้หากยังมีปัญหา

### Quality Gate 8

- [ ] Promotion stacking/cap/funding/concurrency tests ผ่าน
- [ ] Verified-review/date/edit/moderation tests ผ่าน
- [ ] Privacy/RLS/account recovery/deletion tests ผ่าน
- [ ] Support SLA/escalation/closure tests ผ่าน
- [ ] Lao/English และ Responsive QA ผ่าน
- [ ] Commit และ Push Milestone 8
- [ ] จัดทำ Milestone Report 8
- [ ] **OWNER REVIEW GATE 8 — หยุดรอการตรวจรับ**

---

## Milestone 9 — Reports, Notifications, OCR/Barcode, EGO Placeholder และ Backup

### 9.1 Reports and Notifications

- [ ] สร้าง Dashboard KPI จากข้อมูลจริง ห้าม mock ใน Production
- [ ] รายงาน sales/orders/payments/COD/refunds/settlements/stock/store quality/support SLA
- [ ] Filters ใช้ server-side authorization และ scoped queries
- [ ] Report totals reconcile กับ ledgers
- [ ] Notification inbox พร้อม read/unread/action link
- [ ] รองรับ SMS/push/in-app adapters โดยไม่ hard-code provider
- [ ] Retry และ failure queue สำหรับ notifications

### 9.2 Image Search Phase 1

- [ ] เพิ่ม camera/file upload UX พร้อม consent notice
- [ ] อ่าน barcode ใน browser
- [ ] ทำ OCR ใน browserและค้นข้อความใน catalog
- [ ] จำกัด file type/size และ strip unsafe metadata
- [ ] เก็บ uploaded search image ไม่เกิน 24 ชั่วโมง
- [ ] Lifecycle deletion job และ failure alert
- [ ] ห้ามใช้รูปเพื่อ train/analytics โดยไม่มี consent เพิ่มเติม

### 9.3 EGO POS Placeholder — Disabled Only

- [ ] สร้าง Integration Center entry ที่แสดง Disabled/Not configured
- [ ] สร้าง schema: Integration Profile, Mapping, Cursor, Inbox, Outbox, Attempt, Error Queue
- [ ] สร้าง adapter interfaces โดยไม่มี real credentials/endpoints
- [ ] Product/stock direction EGO → Marketplace ใน contract tests/mock เท่านั้น
- [ ] Order direction Marketplace → EGO ใน contract tests/mock เท่านั้น
- [ ] Mapping เป็น system suggestion + staff approval
- [ ] Source of Truth ตั้งแยกตามร้าน
- [ ] สร้าง external ID/idempotency/correlation conventions
- [ ] Mock stale-stock rule 30 นาที
- [ ] Mock retry 5 ครั้ง → Error Queue
- [ ] Mock disable ordering on EGO outage
- [ ] Mock full sync + health check ก่อน auto reopen
- [ ] Feature flag default OFF ทุก Environment
- [ ] CI test ยืนยันว่า Production build ไม่สามารถส่ง EGO traffic เมื่อ flag OFF

### 9.4 Backup and Restore

- [ ] สร้าง daily backup ของ order/payment/settlement critical data
- [ ] สร้าง weekly full backup
- [ ] สร้าง pre-migration backup procedure
- [ ] เข้ารหัส backup และเก็บ cloud แยกจาก primary
- [ ] จัดทำ offline-copy procedure
- [ ] สร้าง checksum/manifest และตรวจ backup completion
- [ ] Alert เมื่อ backup ล้มเหลว
- [ ] เขียน restore runbook
- [ ] ทดสอบ restore เต็มรูปแบบก่อนเปิดจริง
- [ ] บันทึกเวลา RPO/RTO ที่ทำได้จริงจากการทดสอบ

### Quality Gate 9

- [ ] Reports reconcile กับ source ledgers
- [ ] Notification retry/failure tests ผ่าน
- [ ] Barcode/OCR และ 24-hour deletion tests ผ่าน
- [ ] EGO flag OFF และ no-network tests ผ่าน
- [ ] Daily/weekly backup jobs ผ่าน
- [ ] Restore drill ผ่านและมีหลักฐาน
- [ ] Commit และ Push Milestone 9
- [ ] จัดทำ Milestone Report 9
- [ ] **OWNER REVIEW GATE 9 — หยุดรอการตรวจรับ**

---

## Milestone 10 — Backoffice Final QA และ Security Audit

- [ ] ตรวจทุก Backoffice screen บน Desktop, Tablet และ Mobile
- [ ] ตรวจ keyboard navigation, focus, labels, contrast และ error messages
- [ ] ตรวจ Lao/English overflow และ number/date/currency formatting
- [ ] รัน full unit suite
- [ ] รัน full integration suite
- [ ] รัน full permission/RLS suite
- [ ] รัน full financial/inventory/order regression suite
- [ ] รัน end-to-end flow ทุก role
- [ ] รัน dependency, secret และ static security scans
- [ ] ทดสอบ IDOR/BOLA, privilege escalation, session theft/revocation, rate limits และ file access
- [ ] ทดสอบ duplicate/replayed webhooks และ concurrent order/payment/stock operations
- [ ] ทดสอบ backup restore และ incident runbook
- [ ] แก้ Critical/High issues ทั้งหมด
- [ ] บันทึก Medium/Low พร้อม owner/risk/plan
- [ ] ลบ mock/demo bypass จาก Production build
- [ ] ยืนยัน Production ไม่มีข้อมูลจริงก่อน release authorization
- [ ] Commit และ Push Milestone 10
- [ ] จัดทำ Backoffice Final QA Report
- [ ] **OWNER REVIEW GATE 10 — หลังบ้านต้องได้รับอนุมัติก่อนเริ่ม Customer PWA**

---

## Milestone 11 — Customer PWA

### 11.1 Shell and Discovery

- [ ] สร้าง responsive PWA shell สำหรับ Desktop/Android/iOS
- [ ] ใช้ Midnight Navy/Black + Electric Blue + White ตาม design system
- [ ] ตั้ง manifest, icons, installability และ service worker
- [ ] สร้าง Home ที่สมดุล category/deals/stores/top products
- [ ] สร้าง collapsible sections และ Show all
- [ ] Search tabs: Products, Shops, Brands
- [ ] สร้าง Category, Product listing/filter, Store และ Brand pages
- [ ] Product Detail รองรับ images, video, variants, store, shipping, TikTok review link
- [ ] Favorites, recently viewed และ notifications

### 11.2 Account and Checkout

- [ ] Customer SMS OTP signup/login
- [ ] Profile, language และ multiple addresses
- [ ] Cart แยกตาม store
- [ ] Checkout แสดงสินค้า/ส่วนลด/ค่าส่ง/ยอดแยกร้านและยอดรวม
- [ ] Wait-for-supplier confirmation flow
- [ ] QR store grouping selection และ payment status
- [ ] COD rules/limit/deposit UX
- [ ] Parent/Child order history ทั้งมุมมองรวมและแยก

### 11.3 Tracking and After-sales

- [ ] Tracking timeline แยกพัสดุ
- [ ] Cancellation item/store/order ก่อน handoff
- [ ] Return/refund request + evidence upload
- [ ] Reviews/TikTok submissions
- [ ] Support channels: WhatsApp/message, in-app, phone
- [ ] Legal/privacy/return policy pages Lao/English

### 11.4 Offline

- [ ] Cache app shell และหน้าที่เคยเปิดอย่างปลอดภัย
- [ ] เก็บ cart ใน IndexedDB และ sync/revalidate เมื่อกลับ online
- [ ] ห้าม checkout/payment/order mutation ขณะ offline
- [ ] แสดง offline/stale-data status ชัดเจน
- [ ] ห้าม cache sensitive account/payment pages แบบไม่ปลอดภัย

### Quality Gate 11

- [ ] PWA install ผ่าน Desktop/Android/iOS test devices
- [ ] Customer critical E2E QR และ COD ผ่าน
- [ ] Multi-store/partial/cancel/return flows ผ่าน
- [ ] Offline cache/cart/reconnect tests ผ่าน
- [ ] Accessibility/Responsive/Lao-English QA ผ่าน
- [ ] Performance budgets ผ่านตามที่บันทึกใน ADR
- [ ] Security/Permission/Regression suites ผ่าน
- [ ] Commit และ Push Milestone 11
- [ ] จัดทำ Customer PWA QA Report
- [ ] **OWNER REVIEW GATE 11 — หยุดรอการตรวจรับ**

---

## Milestone 12 — Staging, Private Beta Readiness และ Production Hold

- [ ] Deploy Staging จาก tagged/approved commit
- [ ] ใช้ mock/sandbox integrations เท่านั้นจน Owner ให้ credentials
- [ ] Seed ข้อมูลจำลอง 100–500 รายการสำหรับ QA
- [ ] รัน smoke tests บน Staging
- [ ] รัน full E2E บน Staging
- [ ] ตรวจ Cloud/Supabase/R2 free-tier quotas และ alerts
- [ ] ตรวจ SMS cost/rate limit/abuse protection
- [ ] ตรวจ courier/bank manual fallback runbooks
- [ ] ตรวจ monitoring, error tracking และ alert recipients
- [ ] ตรวจ daily critical backup และ weekly full backup
- [ ] ทำ restore drill จาก Staging backup
- [ ] ตรวจ legal/privacy/terms/return copy โดยผู้รับผิดชอบท้องถิ่น
- [ ] สร้าง invite-only access control
- [ ] สร้าง incident response และ rollback checklist
- [ ] สร้าง Private Beta Test Plan โดยยังไม่กำหนดจำนวนผู้ใช้ตายตัว
- [ ] สรุป known issues และรับ risk acceptance จาก Owner
- [ ] สร้าง release candidate tag
- [ ] **PRODUCTION HOLD — ห้าม Deploy จน Owner สั่งเป็นลายลักษณ์อักษร**

---

## Final Completion Checklist

- [ ] ทุก Checkbox ที่เกี่ยวข้องเสร็จหรือมี `N/A — เหตุผล`
- [ ] ทุก Owner Review Gate ได้รับอนุมัติ
- [ ] `requirements.md` ตรงกับระบบที่สร้างจริง
- [ ] Database schema/ERD และ migrations เป็นปัจจุบัน
- [ ] API/OpenAPI หรือ equivalent contract docs เป็นปัจจุบัน
- [ ] Role/Permission matrix เป็นปัจจุบันและผ่าน tests
- [ ] Order/Payment/Inventory/Settlement state diagrams เป็นปัจจุบัน
- [ ] Test reports และ coverage summary แนบครบ
- [ ] Security report ไม่มี Critical/High ค้าง
- [ ] Financial และ Inventory reconciliation ผ่าน
- [ ] Backup/Restore ผ่านจริง
- [ ] EGO POS integration ปิดและไม่มี credentials
- [ ] Staging ผ่าน End-to-End QA
- [ ] Owner อนุมัติ Production deploy
- [ ] Production smoke test ผ่านหลัง deploy
- [ ] Monitoring/backup/alerts ทำงานหลัง deploy
- [ ] ส่ง Final Completion Report ให้ Owner

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
