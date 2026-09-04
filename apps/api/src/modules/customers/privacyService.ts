import type { PGlite } from '@electric-sql/pglite';

import { AuditService } from '../audit/service.js';
import {
  generateOtpCode,
  hashOtp,
  MockSmsProvider,
  type SmsProvider,
} from '../identity/otp.js';

export class CustomerPrivacyService {
  constructor(
    private readonly db: PGlite,
    private readonly sms: SmsProvider = new MockSmsProvider(),
    private readonly audit = new AuditService(db),
  ) {}

  async addAddress(input: {
    customerIdentityId: string;
    label?: string;
    recipientName: string;
    recipientPhoneE164: string;
    addressLine: string;
    district?: string;
    province?: string;
    isDefault?: boolean;
  }) {
    if (input.isDefault) {
      await this.db.query(
        `UPDATE app.customer_addresses SET is_default = false
         WHERE customer_identity_id = $1 AND archived_at IS NULL`,
        [input.customerIdentityId],
      );
    }
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO app.customer_addresses
        (customer_identity_id, label, recipient_name, recipient_phone_e164,
         address_line, district, province, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        input.customerIdentityId,
        input.label ?? 'home',
        input.recipientName,
        input.recipientPhoneE164,
        input.addressLine,
        input.district ?? null,
        input.province ?? null,
        input.isDefault ?? false,
      ],
    );
    return row.rows[0]!.id;
  }

  async snapshotOrderAddress(input: {
    parentOrderId: string;
    addressId: string;
  }) {
    const addr = await this.db.query<{
      recipient_name: string;
      recipient_phone_e164: string;
      address_line: string;
      district: string | null;
      province: string | null;
    }>(`SELECT recipient_name, recipient_phone_e164, address_line, district, province
        FROM app.customer_addresses WHERE id = $1`, [input.addressId]);
    if (!addr.rows[0]) throw new Error('address_not_found');
    const a = addr.rows[0];
    await this.db.query(
      `INSERT INTO app.order_address_snapshots
        (parent_order_id, recipient_name, recipient_phone_e164, address_line, district, province)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        input.parentOrderId,
        a.recipient_name,
        a.recipient_phone_e164,
        a.address_line,
        a.district,
        a.province,
      ],
    );
  }

  async storeDeliveryView(storeId: string, parentOrderId: string) {
    const snap = await this.db.query<{
      recipient_name: string;
      recipient_phone_e164: string;
      address_line: string;
    }>(
      `SELECT recipient_name, recipient_phone_e164, address_line
       FROM app.order_address_snapshots WHERE parent_order_id = $1`,
      [parentOrderId],
    );
    // store may only see delivery-necessary fields (no marketing/account extras)
    void storeId;
    if (!snap.rows[0]) throw new Error('address_snapshot_missing');
    return {
      recipientName: snap.rows[0].recipient_name,
      recipientPhone: snap.rows[0].recipient_phone_e164,
      addressLine: snap.rows[0].address_line,
    };
  }

  async startPhoneChange(input: {
    customerIdentityId: string;
    oldPhone: string;
    newPhone: string;
  }) {
    const oldCode = generateOtpCode();
    const newCode = generateOtpCode();
    const corr = crypto.randomUUID();
    await this.db.query(
      `INSERT INTO security.otp_challenges
        (purpose, destination_phone_e164, code_hash, correlation_id, expires_at, meta)
       VALUES ('phone_change_old',$1,$2,$3, timezone('utc', now()) + interval '10 minutes', $4::jsonb)`,
      [
        input.oldPhone,
        hashOtp(oldCode),
        corr,
        JSON.stringify({ customerIdentityId: input.customerIdentityId, leg: 'old' }),
      ],
    );
    await this.db.query(
      `INSERT INTO security.otp_challenges
        (purpose, destination_phone_e164, code_hash, correlation_id, expires_at, meta)
       VALUES ('phone_change_new',$1,$2,$3, timezone('utc', now()) + interval '10 minutes', $4::jsonb)`,
      [
        input.newPhone,
        hashOtp(newCode),
        corr,
        JSON.stringify({
          customerIdentityId: input.customerIdentityId,
          leg: 'new',
          newPhone: input.newPhone,
        }),
      ],
    );
    await this.sms.sendOtp({
      phoneE164: input.oldPhone,
      code: oldCode,
      purpose: 'phone_change_old',
    });
    await this.sms.sendOtp({
      phoneE164: input.newPhone,
      code: newCode,
      purpose: 'phone_change_new',
    });
    return { correlationId: corr, oldCode, newCode };
  }

  async confirmPhoneChange(input: {
    correlationId: string;
    oldCode: string;
    newCode: string;
    customerIdentityId: string;
  }) {
    const rows = await this.db.query<{
      purpose: string;
      code_hash: string;
      destination_phone_e164: string;
      meta: { newPhone?: string };
    }>(
      `SELECT purpose, code_hash, destination_phone_e164, meta
       FROM security.otp_challenges
       WHERE correlation_id = $1 AND consumed_at IS NULL`,
      [input.correlationId],
    );
    const oldRow = rows.rows.find((r) => r.purpose === 'phone_change_old');
    const newRow = rows.rows.find((r) => r.purpose === 'phone_change_new');
    if (!oldRow || !newRow) throw new Error('phone_change_challenges_missing');
    if (oldRow.code_hash !== hashOtp(input.oldCode) || newRow.code_hash !== hashOtp(input.newCode)) {
      throw new Error('otp_invalid');
    }
    await this.db.query(
      `UPDATE security.auth_identities SET phone_e164 = $2 WHERE id = $1`,
      [input.customerIdentityId, newRow.destination_phone_e164],
    );
    await this.db.query(
      `UPDATE security.otp_challenges SET consumed_at = timezone('utc', now())
       WHERE correlation_id = $1`,
      [input.correlationId],
    );
  }

  async submitRecoveryDocument(input: {
    claimedPhone: string;
    documentStorageKey: string;
  }) {
    if (!input.documentStorageKey.startsWith('private/')) {
      throw new Error('recovery_doc_must_be_private');
    }
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO app.account_recovery_requests
        (claimed_phone_e164, document_storage_key, document_encrypted)
       VALUES ($1,$2,true) RETURNING id`,
      [input.claimedPhone, input.documentStorageKey],
    );
    await this.audit.append({
      actorType: 'system',
      action: 'account.recovery_submitted',
      targetType: 'account_recovery',
      targetId: row.rows[0]!.id,
      correlationId: crypto.randomUUID(),
      afterState: { encrypted: true, private: true },
    });
    return row.rows[0]!.id;
  }

  async requestDeletion(input: {
    customerIdentityId: string;
    otpVerified: boolean;
  }) {
    if (!input.otpVerified) throw new Error('otp_required');
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO app.account_deletion_requests
        (customer_identity_id, otp_verified, status)
       VALUES ($1,true,'pending') RETURNING id`,
      [input.customerIdentityId],
    );
    return row.rows[0]!.id;
  }

  async approveAndAnonymizeDeletion(input: {
    requestId: string;
    approverIdentityId: string;
  }) {
    const req = await this.db.query<{
      customer_identity_id: string;
      status: string;
    }>(`SELECT customer_identity_id, status FROM app.account_deletion_requests WHERE id = $1`, [
      input.requestId,
    ]);
    if (!req.rows[0] || req.rows[0].status !== 'pending') throw new Error('deletion_not_pending');
    const identityId = req.rows[0].customer_identity_id;
    await this.db.query(
      `UPDATE app.customer_profiles
       SET display_name = 'anonymized', marketing_opt_in = false, archived_at = timezone('utc', now())
       WHERE auth_identity_id = $1`,
      [identityId],
    );
    await this.db.query(
      `UPDATE security.auth_identities
       SET phone_e164 = '+000' || substring(replace(id::text, '-', ''), 1, 11),
           subject = 'anonymized:' || id::text
       WHERE id = $1`,
      [identityId],
    );
    await this.db.query(
      `UPDATE app.customer_addresses SET archived_at = timezone('utc', now())
       WHERE customer_identity_id = $1`,
      [identityId],
    );
    await this.db.query(
      `UPDATE app.account_deletion_requests
       SET status = 'completed', approved_by = $2, completed_at = timezone('utc', now())
       WHERE id = $1`,
      [input.requestId, input.approverIdentityId],
    );
    // order/payment records intentionally retained
  }

  async setMarketingOptIn(customerIdentityId: string, optIn: boolean) {
    await this.db.query(
      `UPDATE app.customer_profiles SET marketing_opt_in = $2 WHERE auth_identity_id = $1`,
      [customerIdentityId, optIn],
    );
  }

  async getProfile(customerIdentityId: string) {
    const row = await this.db.query<{
      display_name: string;
      marketing_opt_in: boolean;
      phone_e164: string | null;
    }>(
      `SELECT cp.display_name, cp.marketing_opt_in, i.phone_e164
       FROM app.customer_profiles cp
       JOIN security.auth_identities i ON i.id = cp.auth_identity_id
       WHERE cp.auth_identity_id = $1
       LIMIT 1`,
      [customerIdentityId],
    );
    const r = row.rows[0];
    if (!r) throw new Error('customer_not_found');
    return {
      displayName: r.display_name,
      marketingOptIn: r.marketing_opt_in,
      phoneE164: r.phone_e164,
    };
  }

  async listAddresses(customerIdentityId: string) {
    const rows = await this.db.query<{
      id: string;
      label: string | null;
      recipient_name: string;
      recipient_phone_e164: string;
      address_line: string;
      district: string | null;
      province: string | null;
      is_default: boolean;
    }>(
      `SELECT id, label, recipient_name, recipient_phone_e164, address_line,
              district, province, is_default
       FROM app.customer_addresses
       WHERE customer_identity_id = $1 AND archived_at IS NULL
       ORDER BY is_default DESC, created_at DESC`,
      [customerIdentityId],
    );
    return rows.rows.map((r) => ({
      addressId: r.id,
      label: r.label,
      recipientName: r.recipient_name,
      recipientPhoneE164: r.recipient_phone_e164,
      addressLine: r.address_line,
      district: r.district,
      province: r.province,
      isDefault: r.is_default,
    }));
  }

  async listDeletionRequests(limit = 50) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      id: string;
      customer_identity_id: string;
      status: string;
      otp_verified: boolean;
      approved_by: string | null;
      created_at: string;
      completed_at: string | null;
    }>(
      `SELECT id, customer_identity_id, status, otp_verified, approved_by,
              created_at::text, completed_at::text
       FROM app.account_deletion_requests
       ORDER BY created_at DESC
       LIMIT $1`,
      [capped],
    );
    return rows.rows.map((r) => ({
      requestId: r.id,
      customerIdentityId: r.customer_identity_id,
      status: r.status,
      otpVerified: r.otp_verified,
      approvedBy: r.approved_by,
      createdAt: r.created_at,
      completedAt: r.completed_at,
    }));
  }
}
