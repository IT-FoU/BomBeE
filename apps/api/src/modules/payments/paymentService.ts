import type { PGlite } from '@electric-sql/pglite';

import { AuditService } from '../audit/service.js';
import {
  assertQrDeadlineValid,
  computeQrDeadline,
  evaluateCodEligibility,
  allocationSum,
  type PaymentConfirmChannel,
} from './rules.js';

export type BankAdapter = {
  verifyTransfer: (input: {
    referenceCode: string;
    amountLak: number;
    bankRef: string;
  }) => Promise<{ matched: boolean; amountLak: number }>;
};

export class ManualBankAdapter implements BankAdapter {
  async verifyTransfer(input: {
    referenceCode: string;
    amountLak: number;
    bankRef: string;
  }) {
    return { matched: true, amountLak: input.amountLak };
  }
}

export class PaymentService {
  constructor(
    private readonly db: PGlite,
    private readonly bank: BankAdapter = new ManualBankAdapter(),
    private readonly audit = new AuditService(db),
  ) {}

  async createQrPaymentRequest(input: {
    parentOrderId: string;
    childOrderIds: string[];
    actorIdentityId: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const children = await this.db.query<{
      id: string;
      status: string;
      total_lak: number;
      parent_order_id: string;
    }>(
      `SELECT id, status, total_lak, parent_order_id
       FROM app.child_orders
       WHERE parent_order_id = $1 AND id = ANY($2::uuid[])`,
      [input.parentOrderId, input.childOrderIds],
    );
    if (children.rows.length !== input.childOrderIds.length) {
      throw new Error('child_orders_not_found');
    }
    for (const child of children.rows) {
      if (!['confirmed', 'partial_confirmed', 'awaiting_payment'].includes(child.status)) {
        throw new Error('qr_requires_supplier_confirmation');
      }
    }

    const allocations = children.rows.map((c) => ({
      childOrderId: c.id,
      amountLak: Number(c.total_lak),
    }));
    const amountLak = allocationSum(allocations);
    const expiresAt = computeQrDeadline(now);
    assertQrDeadlineValid(expiresAt, now);

    const referenceCode = `QR-${Date.now()}`;
    const req = await this.db.query<{ id: string }>(
      `INSERT INTO finance.payment_requests
        (parent_order_id, reference_code, method, amount_lak, expires_at)
       VALUES ($1,$2,'qr',$3,$4) RETURNING id`,
      [input.parentOrderId, referenceCode, amountLak, expiresAt.toISOString()],
    );
    const paymentRequestId = req.rows[0]!.id;
    for (const alloc of allocations) {
      await this.db.query(
        `INSERT INTO finance.payment_allocations
          (payment_request_id, child_order_id, amount_lak)
         VALUES ($1,$2,$3)`,
        [paymentRequestId, alloc.childOrderId, alloc.amountLak],
      );
      await this.db.query(
        `UPDATE app.child_orders SET status = 'awaiting_payment' WHERE id = $1`,
        [alloc.childOrderId],
      );
    }

    await this.audit.append({
      actorIdentityId: input.actorIdentityId,
      actorType: 'customer',
      action: 'payment.qr_created',
      targetType: 'payment_request',
      targetId: paymentRequestId,
      correlationId: crypto.randomUUID(),
      afterState: { referenceCode, amountLak, childOrderIds: input.childOrderIds },
    });

    return { paymentRequestId, referenceCode, amountLak, expiresAt: expiresAt.toISOString() };
  }

  async submitEvidence(input: {
    paymentRequestId: string;
    amountReportedLak: number;
    evidenceStorageKey: string;
    idempotencyKey: string;
  }) {
    const latest = await this.db.query<{ attempt_no: number }>(
      `SELECT attempt_no FROM finance.payment_attempts
       WHERE payment_request_id = $1 ORDER BY attempt_no DESC LIMIT 1`,
      [input.paymentRequestId],
    );
    const attemptNo = (latest.rows[0]?.attempt_no ?? 0) + 1;
    try {
      const row = await this.db.query<{ id: string }>(
        `INSERT INTO finance.payment_attempts
          (payment_request_id, attempt_no, channel, amount_reported_lak,
           evidence_storage_key, evidence_status, status, idempotency_key)
         VALUES ($1,$2,'manual',$3,$4,'pending','pending',$5)
         RETURNING id`,
        [
          input.paymentRequestId,
          attemptNo,
          input.amountReportedLak,
          input.evidenceStorageKey,
          input.idempotencyKey,
        ],
      );
      return { attemptId: row.rows[0]!.id, evidenceStatus: 'pending' as const };
    } catch {
      const existing = await this.db.query<{ id: string; evidence_status: string }>(
        `SELECT id, evidence_status FROM finance.payment_attempts WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (!existing.rows[0]) throw new Error('attempt_insert_failed');
      return {
        attemptId: existing.rows[0].id,
        evidenceStatus: existing.rows[0].evidence_status,
        idempotentReplay: true as const,
      };
    }
  }

  async confirmPayment(input: {
    paymentRequestId: string;
    attemptId: string;
    channel: PaymentConfirmChannel;
    amountLak: number;
    bankRef: string;
    idempotencyKey: string;
    actorIdentityId: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const req = await this.db.query<{
      id: string;
      amount_lak: number;
      status: string;
      expires_at: string;
      reference_code: string;
    }>(
      `SELECT id, amount_lak, status, expires_at::text, reference_code
       FROM finance.payment_requests WHERE id = $1`,
      [input.paymentRequestId],
    );
    const payment = req.rows[0];
    if (!payment) return { ok: false as const, reason: 'not_found' };
    if (payment.status === 'expired' || Date.parse(payment.expires_at) < now.getTime()) {
      await this.db.query(
        `UPDATE finance.payment_requests SET status = 'expired' WHERE id = $1`,
        [payment.id],
      );
      return { ok: false as const, reason: 'expired' };
    }

    // idempotent confirmation via bank/courier ref
    const existingRef = await this.db.query<{ id: string; status: string }>(
      `SELECT id, status FROM finance.payment_attempts WHERE bank_or_courier_ref = $1`,
      [input.bankRef],
    );
    if (existingRef.rows[0]?.status === 'confirmed') {
      return { ok: true as const, idempotentReplay: true as const };
    }

    const byKey = await this.db.query<{ id: string; status: string }>(
      `SELECT id, status FROM finance.payment_attempts WHERE idempotency_key = $1`,
      [input.idempotencyKey],
    );
    if (byKey.rows[0]?.status === 'confirmed') {
      return { ok: true as const, idempotentReplay: true as const };
    }

    if (input.channel === 'bank_api') {
      const verified = await this.bank.verifyTransfer({
        referenceCode: payment.reference_code,
        amountLak: input.amountLak,
        bankRef: input.bankRef,
      });
      if (!verified.matched) return { ok: false as const, reason: 'bank_mismatch' };
    }

    await this.db.query(
      `UPDATE finance.payment_attempts
       SET status = 'confirmed', evidence_status = 'verified',
           bank_or_courier_ref = $2, confirmed_at = $5,
           channel = $3, amount_reported_lak = $4
       WHERE id = $1`,
      [input.attemptId, input.bankRef, input.channel, input.amountLak, now.toISOString()],
    );

    try {
      await this.db.query(
        `INSERT INTO finance.payment_receipts (payment_attempt_id, amount_lak, source, received_at)
         VALUES ($1,$2,$3,$4)`,
        [
          input.attemptId,
          input.amountLak,
          input.channel === 'bank_api' ? 'bank_api' : 'manual',
          now.toISOString(),
        ],
      );
    } catch {
      return { ok: true as const, idempotentReplay: true as const };
    }

    const expected = Number(payment.amount_lak);
    if (input.amountLak > expected) {
      await this.db.query(
        `INSERT INTO finance.payment_refunds
          (payment_request_id, amount_lak, reason, linked_attempt_id)
         VALUES ($1,$2,'excess',$3)`,
        [payment.id, input.amountLak - expected, input.attemptId],
      );
      await this.markPaid(payment.id);
      return { ok: true as const, excessRefundLak: input.amountLak - expected };
    }

    if (input.amountLak < expected) {
      await this.db.query(
        `UPDATE finance.payment_requests SET status = 'partially_paid' WHERE id = $1`,
        [payment.id],
      );
      const remainder = expected - input.amountLak;
      const followUp = await this.createUnderpaymentQr({
        parentOrderId: (
          await this.db.query<{ parent_order_id: string }>(
            `SELECT parent_order_id FROM finance.payment_requests WHERE id = $1`,
            [payment.id],
          )
        ).rows[0]!.parent_order_id,
        remainderLak: remainder,
        linkedAttemptId: input.attemptId,
        now,
      });
      return { ok: true as const, underpaymentFollowUp: followUp };
    }

    await this.markPaid(payment.id);
    await this.audit.append({
      actorIdentityId: input.actorIdentityId,
      actorType: 'staff',
      action: 'payment.confirmed',
      targetType: 'payment_request',
      targetId: payment.id,
      correlationId: crypto.randomUUID(),
      afterState: { amountLak: input.amountLak, bankRef: input.bankRef },
    });
    return { ok: true as const };
  }

  private async markPaid(paymentRequestId: string) {
    await this.db.query(
      `UPDATE finance.payment_requests SET status = 'paid' WHERE id = $1`,
      [paymentRequestId],
    );
    await this.db.query(
      `UPDATE app.child_orders
       SET payment_received = true
       WHERE id IN (
         SELECT child_order_id FROM finance.payment_allocations WHERE payment_request_id = $1
       )`,
      [paymentRequestId],
    );
  }

  private async createUnderpaymentQr(input: {
    parentOrderId: string;
    remainderLak: number;
    linkedAttemptId: string;
    now: Date;
  }) {
    const expiresAt = computeQrDeadline(input.now);
    const referenceCode = `QR-REM-${Date.now()}`;
    const req = await this.db.query<{ id: string }>(
      `INSERT INTO finance.payment_requests
        (parent_order_id, reference_code, method, amount_lak, expires_at)
       VALUES ($1,$2,'qr',$3,$4) RETURNING id`,
      [input.parentOrderId, referenceCode, input.remainderLak, expiresAt.toISOString()],
    );
    await this.db.query(
      `INSERT INTO finance.payment_attempts
        (payment_request_id, attempt_no, channel, amount_reported_lak,
         evidence_status, status, idempotency_key)
       VALUES ($1,1,'manual',0,'not_required','pending',$2)`,
      [req.rows[0]!.id, `underpay-link:${input.linkedAttemptId}`],
    );
    return {
      paymentRequestId: req.rows[0]!.id,
      referenceCode,
      amountLak: input.remainderLak,
      linkedAttemptId: input.linkedAttemptId,
    };
  }

  async expirePaymentRequest(paymentRequestId: string, now = new Date()) {
    const req = await this.db.query<{ expires_at: string; status: string }>(
      `SELECT expires_at::text, status FROM finance.payment_requests WHERE id = $1`,
      [paymentRequestId],
    );
    const row = req.rows[0];
    if (!row) return { ok: false as const, reason: 'not_found' };
    if (row.status === 'paid') return { ok: false as const, reason: 'already_paid' };
    if (row.status === 'expired' || row.status === 'cancelled') {
      return { ok: true as const, status: row.status as 'expired' | 'cancelled', idempotentReplay: true as const };
    }
    if (Date.parse(row.expires_at) > now.getTime()) return { ok: false as const, reason: 'not_due' };
    await this.db.query(
      `UPDATE finance.payment_requests SET status = 'expired' WHERE id = $1`,
      [paymentRequestId],
    );
    return { ok: true as const, status: 'expired' as const };
  }

  /** Expire open/partially_paid QR requests whose expires_at has passed. */
  async expireDueOpenRequests(now = new Date()) {
    const due = await this.db.query<{ id: string }>(
      `SELECT id FROM finance.payment_requests
       WHERE status IN ('open', 'partially_paid')
         AND expires_at <= $1
       ORDER BY expires_at`,
      [now.toISOString()],
    );
    const results: Array<{
      paymentRequestId: string;
      ok: boolean;
      status?: string;
      reason?: string;
    }> = [];
    for (const row of due.rows) {
      const expired = await this.expirePaymentRequest(row.id, now);
      results.push({
        paymentRequestId: row.id,
        ok: expired.ok,
        ...(expired.ok
          ? { status: expired.status }
          : { reason: expired.reason }),
      });
    }
    return results;
  }

  async ensureCodProfile(customerIdentityId: string) {
    await this.db.query(
      `INSERT INTO finance.cod_profiles (customer_identity_id)
       VALUES ($1) ON CONFLICT DO NOTHING`,
      [customerIdentityId],
    );
  }

  async createCodShipment(input: {
    customerIdentityId: string;
    childOrderId: string;
    shipmentId?: string;
    amountLak: number;
    phoneVerified: boolean;
  }) {
    await this.ensureCodProfile(input.customerIdentityId);
    const profile = await this.db.query<{
      is_new_customer: boolean;
      failed_cod_count: number;
      qr_forced: boolean;
    }>(
      `SELECT is_new_customer, failed_cod_count, qr_forced
       FROM finance.cod_profiles WHERE customer_identity_id = $1`,
      [input.customerIdentityId],
    );
    const p = profile.rows[0]!;
    const eligibility = evaluateCodEligibility({
      amountLak: input.amountLak,
      isNewCustomer: p.is_new_customer,
      failedCodCount: p.failed_cod_count,
      qrForced: p.qr_forced,
      phoneVerified: input.phoneVerified,
    });
    if (!eligibility.ok) return eligibility;

    const row = await this.db.query<{ id: string }>(
      `INSERT INTO finance.cod_shipments
        (child_order_id, shipment_id, amount_lak, deposit_lak, balance_due_lak, phone_verified)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        input.childOrderId,
        input.shipmentId ?? null,
        input.amountLak,
        eligibility.depositLak,
        input.amountLak - eligibility.depositLak,
        input.phoneVerified,
      ],
    );
    await this.db.query(
      `UPDATE app.child_orders SET status = 'awaiting_cod' WHERE id = $1`,
      [input.childOrderId],
    );
    return {
      ok: true as const,
      codShipmentId: row.rows[0]!.id,
      depositLak: eligibility.depositLak,
      balanceDueLak: input.amountLak - eligibility.depositLak,
    };
  }

  async recordCustomerCodFailure(customerIdentityId: string, customerCaused: boolean) {
    if (!customerCaused) return { failedCodCount: 0, qrForced: false, skipped: true as const };
    await this.ensureCodProfile(customerIdentityId);
    const row = await this.db.query<{ failed_cod_count: number; qr_forced: boolean }>(
      `UPDATE finance.cod_profiles
       SET failed_cod_count = failed_cod_count + 1,
           qr_forced = CASE WHEN failed_cod_count + 1 >= 2 THEN true ELSE qr_forced END,
           updated_at = timezone('utc', now())
       WHERE customer_identity_id = $1
       RETURNING failed_cod_count, qr_forced`,
      [customerIdentityId],
    );
    return {
      failedCodCount: row.rows[0]!.failed_cod_count,
      qrForced: row.rows[0]!.qr_forced,
      skipped: false as const,
    };
  }

  async restoreCod(input: {
    customerIdentityId: string;
    actorIdentityId: string;
    reason: string;
  }) {
    await this.ensureCodProfile(input.customerIdentityId);
    await this.db.query(
      `UPDATE finance.cod_profiles
       SET qr_forced = false, failed_cod_count = 0, updated_at = timezone('utc', now())
       WHERE customer_identity_id = $1`,
      [input.customerIdentityId],
    );
    await this.audit.append({
      actorIdentityId: input.actorIdentityId,
      actorType: 'staff',
      action: 'cod.restored',
      targetType: 'customer',
      targetId: input.customerIdentityId,
      reason: input.reason,
      correlationId: crypto.randomUUID(),
    });
    return { ok: true as const };
  }

  async requireRedeliveryFee(childOrderId: string, amountLak: number) {
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO finance.redelivery_fees (child_order_id, amount_lak)
       VALUES ($1,$2) RETURNING id`,
      [childOrderId, amountLak],
    );
    return row.rows[0]!.id;
  }

  async listCodProfiles(limit = 50) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      customer_identity_id: string;
      subject: string | null;
      is_new_customer: boolean;
      failed_cod_count: number;
      qr_forced: boolean;
      updated_at: string;
    }>(
      `SELECT p.customer_identity_id, i.subject, p.is_new_customer, p.failed_cod_count,
              p.qr_forced, p.updated_at::text
       FROM finance.cod_profiles p
       LEFT JOIN security.auth_identities i ON i.id = p.customer_identity_id
       ORDER BY p.updated_at DESC
       LIMIT $1`,
      [capped],
    );
    return rows.rows.map((r) => ({
      customerIdentityId: r.customer_identity_id,
      subject: r.subject,
      isNewCustomer: r.is_new_customer,
      failedCodCount: Number(r.failed_cod_count),
      qrForced: r.qr_forced,
      updatedAt: r.updated_at,
    }));
  }

  async listRedeliveryFees(limit = 50) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      id: string;
      child_order_id: string;
      amount_lak: number;
      created_at: string;
    }>(
      `SELECT id, child_order_id, amount_lak, created_at::text
       FROM finance.redelivery_fees
       ORDER BY created_at DESC
       LIMIT $1`,
      [capped],
    );
    return rows.rows.map((r) => ({
      redeliveryFeeId: r.id,
      childOrderId: r.child_order_id,
      amountLak: Number(r.amount_lak),
      createdAt: r.created_at,
    }));
  }

  async recordCourierRemittance(input: {
    courierRef: string;
    amountLak: number;
    codShipmentId: string;
  }) {
    const rem = await this.db.query<{ id: string }>(
      `INSERT INTO finance.courier_remittances (courier_ref, amount_lak)
       VALUES ($1,$2) RETURNING id`,
      [input.courierRef, input.amountLak],
    );
    await this.db.query(
      `INSERT INTO finance.cod_remittance_links (cod_shipment_id, remittance_id, amount_lak)
       VALUES ($1,$2,$3)`,
      [input.codShipmentId, rem.rows[0]!.id, input.amountLak],
    );
    await this.db.query(
      `UPDATE finance.cod_shipments SET status = 'remitted' WHERE id = $1`,
      [input.codShipmentId],
    );
    // delivery proof is separate — do not mark delivered here
    return rem.rows[0]!.id;
  }

  async reconcileBank(paymentRequestId: string) {
    const req = await this.db.query<{ amount_lak: number }>(
      `SELECT amount_lak FROM finance.payment_requests WHERE id = $1`,
      [paymentRequestId],
    );
    if (!req.rows[0]) throw new Error('payment_request_not_found');
    const receipts = await this.db.query<{ total: number }>(
      `SELECT coalesce(sum(r.amount_lak),0)::bigint AS total
       FROM finance.payment_receipts r
       JOIN finance.payment_attempts a ON a.id = r.payment_attempt_id
       WHERE a.payment_request_id = $1 AND a.status = 'confirmed'`,
      [paymentRequestId],
    );
    const expected = Number(req.rows[0]?.amount_lak ?? 0);
    const actual = Number(receipts.rows[0]?.total ?? 0);
    const alloc = await this.db.query<{ total: number }>(
      `SELECT coalesce(sum(amount_lak),0)::bigint AS total
       FROM finance.payment_allocations WHERE payment_request_id = $1`,
      [paymentRequestId],
    );
    const allocationTotal = Number(alloc.rows[0]?.total ?? 0);
    if (expected !== allocationTotal) {
      await this.db.query(
        `INSERT INTO finance.recon_mismatches
          (mismatch_type, reference_id, expected_lak, actual_lak)
         VALUES ('allocation',$1,$2,$3)`,
        [paymentRequestId, expected, allocationTotal],
      );
    }
    if (actual !== expected && actual !== 0) {
      // overpay may have refund; underpay has follow-up — still record if unexplained
      const refunds = await this.db.query<{ total: number }>(
        `SELECT coalesce(sum(amount_lak),0)::bigint AS total
         FROM finance.payment_refunds WHERE payment_request_id = $1 AND reason = 'excess'`,
        [paymentRequestId],
      );
      const explained = actual - Number(refunds.rows[0]?.total ?? 0);
      if (explained !== expected && actual < expected) {
        // underpayment with follow-up QR is OK — difference expected
      } else if (explained !== expected && actual > expected) {
        // excess refund covers
      } else if (actual !== expected && Number(refunds.rows[0]?.total ?? 0) === 0 && actual > expected) {
        await this.db.query(
          `INSERT INTO finance.recon_mismatches
            (mismatch_type, reference_id, expected_lak, actual_lak)
           VALUES ('bank',$1,$2,$3)`,
          [paymentRequestId, expected, actual],
        );
      }
    }
    return {
      expectedLak: expected,
      actualLak: actual,
      allocationLak: allocationTotal,
      difference: actual - expected,
    };
  }

  async reconcileCod(codShipmentId: string) {
    const cod = await this.db.query<{ balance_due_lak: number }>(
      `SELECT balance_due_lak FROM finance.cod_shipments WHERE id = $1`,
      [codShipmentId],
    );
    const remitted = await this.db.query<{ total: number }>(
      `SELECT coalesce(sum(amount_lak),0)::bigint AS total
       FROM finance.cod_remittance_links WHERE cod_shipment_id = $1`,
      [codShipmentId],
    );
    const expected = Number(cod.rows[0]?.balance_due_lak ?? 0);
    const actual = Number(remitted.rows[0]?.total ?? 0);
    if (expected !== actual) {
      await this.db.query(
        `INSERT INTO finance.recon_mismatches
          (mismatch_type, reference_id, expected_lak, actual_lak)
         VALUES ('cod',$1,$2,$3)`,
        [codShipmentId, expected, actual],
      );
    }
    return { expectedLak: expected, actualLak: actual, difference: actual - expected };
  }

  async resolveMismatch(input: {
    mismatchId: string;
    actorIdentityId: string;
    note: string;
    createAdjustment?: { amountLak: number; paymentRequestId?: string | null };
  }) {
    let adjustmentId: string | undefined;
    if (input.createAdjustment) {
      const adj = await this.db.query<{ id: string }>(
        `INSERT INTO finance.payment_adjustments
          (payment_request_id, amount_lak, reason, status, maker_identity_id)
         VALUES ($1,$2,$3,'pending',$4) RETURNING id`,
        [
          input.createAdjustment.paymentRequestId ?? null,
          input.createAdjustment.amountLak,
          input.note,
          input.actorIdentityId,
        ],
      );
      adjustmentId = adj.rows[0]!.id;
    }
    await this.db.query(
      `UPDATE finance.recon_mismatches
       SET status = 'resolved', resolution_note = $2, resolved_at = timezone('utc', now())
       WHERE id = $1`,
      [input.mismatchId, input.note],
    );
    return { ok: true as const, adjustmentId };
  }

  async approveAdjustment(input: {
    adjustmentId: string;
    approverIdentityId: string;
  }) {
    const row = await this.db.query<{ maker_identity_id: string; status: string }>(
      `SELECT maker_identity_id, status FROM finance.payment_adjustments WHERE id = $1`,
      [input.adjustmentId],
    );
    const current = row.rows[0];
    if (!current) return { ok: false as const, reason: 'not_found' };
    if (current.status !== 'pending') return { ok: false as const, reason: 'not_pending' };
    if (current.maker_identity_id === input.approverIdentityId) {
      return { ok: false as const, reason: 'self_approval' };
    }
    await this.db.query(
      `UPDATE finance.payment_adjustments
       SET status = 'approved', approver_identity_id = $2, decided_at = timezone('utc', now())
       WHERE id = $1`,
      [input.adjustmentId, input.approverIdentityId],
    );
    return { ok: true as const };
  }

  async listMismatches(limit = 50) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      id: string;
      mismatch_type: string;
      reference_id: string;
      expected_lak: number;
      actual_lak: number;
      status: string;
      resolution_note: string | null;
      created_at: string;
      resolved_at: string | null;
    }>(
      `SELECT id, mismatch_type, reference_id, expected_lak, actual_lak, status,
              resolution_note, created_at::text, resolved_at::text
       FROM finance.recon_mismatches
       ORDER BY created_at DESC
       LIMIT $1`,
      [capped],
    );
    return rows.rows.map((r) => ({
      mismatchId: r.id,
      mismatchType: r.mismatch_type,
      referenceId: r.reference_id,
      expectedLak: Number(r.expected_lak),
      actualLak: Number(r.actual_lak),
      status: r.status,
      resolutionNote: r.resolution_note,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
    }));
  }

  async listAdjustments(limit = 50) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      id: string;
      payment_request_id: string | null;
      child_order_id: string | null;
      amount_lak: number;
      reason: string;
      status: string;
      maker_identity_id: string;
      approver_identity_id: string | null;
      created_at: string;
      decided_at: string | null;
    }>(
      `SELECT id, payment_request_id, child_order_id, amount_lak, reason, status,
              maker_identity_id, approver_identity_id, created_at::text, decided_at::text
       FROM finance.payment_adjustments
       ORDER BY created_at DESC
       LIMIT $1`,
      [capped],
    );
    return rows.rows.map((r) => ({
      adjustmentId: r.id,
      paymentRequestId: r.payment_request_id,
      childOrderId: r.child_order_id,
      amountLak: Number(r.amount_lak),
      reason: r.reason,
      status: r.status,
      makerIdentityId: r.maker_identity_id,
      approverIdentityId: r.approver_identity_id,
      createdAt: r.created_at,
      decidedAt: r.decided_at,
    }));
  }

  async dailyTotalsProof(dayUtc: string) {
    const totals = await this.db.query<{ receipt_total_lak: number; receipt_count: number }>(
      `SELECT receipt_total_lak, receipt_count FROM finance.daily_payment_totals WHERE day_utc = $1::date`,
      [dayUtc],
    );
    const byChild = await this.db.query<{ child_order_id: string; amount_lak: number }>(
      `SELECT a.child_order_id, sum(a.amount_lak)::bigint AS amount_lak
       FROM finance.payment_allocations a
       JOIN finance.payment_requests pr ON pr.id = a.payment_request_id
       JOIN finance.payment_attempts pa ON pa.payment_request_id = pr.id AND pa.status = 'confirmed'
       JOIN finance.payment_receipts r ON r.payment_attempt_id = pa.id
       WHERE timezone('utc', r.received_at)::date = $1::date
       GROUP BY a.child_order_id`,
      [dayUtc],
    );
    return {
      dayTotal: Number(totals.rows[0]?.receipt_total_lak ?? 0),
      childTotals: byChild.rows.map((r) => ({
        childOrderId: r.child_order_id,
        amountLak: Number(r.amount_lak),
      })),
    };
  }
}
