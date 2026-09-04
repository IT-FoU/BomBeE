import type { PGlite } from '@electric-sql/pglite';

import { AuditService } from '../audit/service.js';
import { isLatePacking, packingDueAt } from './rules.js';

export type CourierAdapter = {
  createShipment: (input: {
    trackingHint?: string;
    childOrderId: string;
  }) => Promise<{ trackingNumber: string; externalRef: string }>;
};

export class ManualCourierAdapter implements CourierAdapter {
  async createShipment(input: { trackingHint?: string; childOrderId: string }) {
    return {
      trackingNumber: input.trackingHint ?? `MAN-${Date.now()}`,
      externalRef: `manual:${input.childOrderId}`,
    };
  }
}

export class ApiCourierAdapter implements CourierAdapter {
  async createShipment(input: { trackingHint?: string; childOrderId: string }) {
    return {
      trackingNumber: input.trackingHint ?? `API-${Date.now()}`,
      externalRef: `api:${input.childOrderId}:${crypto.randomUUID()}`,
    };
  }
}

export class DeliveryService {
  constructor(
    private readonly db: PGlite,
    private readonly audit = new AuditService(db),
  ) {}

  async createCourier(input: {
    code: string;
    name: string;
    podMethods?: string[];
    lostLiability?: string;
    damagedLiability?: string;
    compensationRules?: Record<string, unknown>;
  }) {
    const courier = await this.db.query<{ id: string }>(
      `INSERT INTO app.couriers (code, name) VALUES ($1,$2) RETURNING id`,
      [input.code, input.name],
    );
    const contract = await this.db.query<{ id: string }>(
      `INSERT INTO app.courier_contracts
        (courier_id, version_no, pod_methods, lost_liability_party, damaged_liability_party, compensation_rules)
       VALUES ($1,1,$2,$3,$4,$5::jsonb) RETURNING id`,
      [
        courier.rows[0]!.id,
        input.podMethods ?? ['otp', 'signature', 'photo', 'api'],
        input.lostLiability ?? 'courier',
        input.damagedLiability ?? 'courier',
        JSON.stringify(input.compensationRules ?? { maxLak: 500_000 }),
      ],
    );
    return { courierId: courier.rows[0]!.id, contractId: contract.rows[0]!.id };
  }

  async schedulePackingDeadline(childOrderId: string, confirmedAt: Date) {
    const due = packingDueAt(confirmedAt);
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO app.packing_deadlines (child_order_id, confirmed_at, due_at)
       VALUES ($1,$2,$3)
       ON CONFLICT (child_order_id) DO UPDATE
         SET confirmed_at = EXCLUDED.confirmed_at, due_at = EXCLUDED.due_at
       RETURNING id`,
      [childOrderId, confirmedAt.toISOString(), due.toISOString()],
    );
    return { id: row.rows[0]!.id, dueAt: due.toISOString() };
  }

  async markPacked(childOrderId: string, packedAt: Date, now = packedAt) {
    const row = await this.db.query<{
      confirmed_at: string;
      id: string;
    }>(`SELECT id, confirmed_at FROM app.packing_deadlines WHERE child_order_id = $1`, [
      childOrderId,
    ]);
    if (!row.rows[0]) throw new Error('packing_deadline_missing');
    const confirmedAt = new Date(row.rows[0].confirmed_at);
    const late = isLatePacking(confirmedAt, packedAt, now);
    await this.db.query(
      `UPDATE app.packing_deadlines
       SET packed_at = $2, late = $3, alerted_at = CASE WHEN $3 THEN coalesce(alerted_at, $4) ELSE alerted_at END
       WHERE child_order_id = $1`,
      [childOrderId, packedAt.toISOString(), late, now.toISOString()],
    );
    return { late };
  }

  async evaluateLatePacking(childOrderId: string, now: Date) {
    const row = await this.db.query<{
      confirmed_at: string;
      packed_at: string | null;
    }>(`SELECT confirmed_at, packed_at FROM app.packing_deadlines WHERE child_order_id = $1`, [
      childOrderId,
    ]);
    if (!row.rows[0]) return { late: false };
    const late = isLatePacking(
      new Date(row.rows[0].confirmed_at),
      row.rows[0].packed_at ? new Date(row.rows[0].packed_at) : null,
      now,
    );
    if (late) {
      await this.db.query(
        `UPDATE app.packing_deadlines
         SET late = true, alerted_at = coalesce(alerted_at, $2)
         WHERE child_order_id = $1`,
        [childOrderId, now.toISOString()],
      );
    }
    return { late };
  }

  async listPackingDeadlines(limit = 50, lateOnly = false) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      id: string;
      child_order_id: string;
      confirmed_at: string;
      due_at: string;
      packed_at: string | null;
      late: boolean;
      alerted_at: string | null;
      child_status: string;
    }>(
      `SELECT p.id, p.child_order_id, p.confirmed_at::text, p.due_at::text,
              p.packed_at::text, p.late, p.alerted_at::text, co.status AS child_status
       FROM app.packing_deadlines p
       JOIN app.child_orders co ON co.id = p.child_order_id
       WHERE ($2::boolean = false OR p.late = true)
       ORDER BY p.due_at ASC
       LIMIT $1`,
      [capped, lateOnly],
    );
    return rows.rows.map((r) => ({
      packingDeadlineId: r.id,
      childOrderId: r.child_order_id,
      confirmedAt: r.confirmed_at,
      dueAt: r.due_at,
      packedAt: r.packed_at,
      late: r.late,
      alertedAt: r.alerted_at,
      childStatus: r.child_status,
    }));
  }

  async createDelivery(input: {
    childOrderId: string;
    courierId: string;
    channel: 'manual' | 'api';
    adapter: CourierAdapter;
    packagePhotoKey?: string;
    trackingHint?: string;
    actorIdentityId: string;
  }) {
    const contract = await this.db.query<{ id: string; pod_methods: string[] }>(
      `SELECT id, pod_methods FROM app.courier_contracts
       WHERE courier_id = $1
       ORDER BY version_no DESC LIMIT 1`,
      [input.courierId],
    );
    if (!contract.rows[0]) throw new Error('courier_contract_missing');

    const shipment = await this.db.query<{ id: string }>(
      `INSERT INTO app.shipments (child_order_id, status)
       VALUES ($1,'approved') RETURNING id`,
      [input.childOrderId],
    );
    const created = await input.adapter.createShipment({
      childOrderId: input.childOrderId,
      trackingHint: input.trackingHint,
    });
    const delivery = await this.db.query<{ id: string }>(
      `INSERT INTO app.shipment_deliveries
        (shipment_id, child_order_id, courier_id, courier_contract_id, channel,
         tracking_number, package_photo_key, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'created') RETURNING id`,
      [
        shipment.rows[0]!.id,
        input.childOrderId,
        input.courierId,
        contract.rows[0].id,
        input.channel,
        created.trackingNumber,
        input.packagePhotoKey ?? null,
      ],
    );
    await this.audit.append({
      actorIdentityId: input.actorIdentityId,
      actorType: 'staff',
      action: 'delivery.created',
      targetType: 'shipment_delivery',
      targetId: delivery.rows[0]!.id,
      afterState: { channel: input.channel, tracking: created.trackingNumber },
      correlationId: crypto.randomUUID(),
    });
    return {
      deliveryId: delivery.rows[0]!.id,
      shipmentId: shipment.rows[0]!.id,
      trackingNumber: created.trackingNumber,
      podMethods: contract.rows[0].pod_methods,
    };
  }

  async handoff(input: {
    deliveryId: string;
    handoffAt: Date;
    actorIdentityId: string;
  }) {
    await this.db.query(
      `UPDATE app.shipment_deliveries
       SET handoff_at = $2, status = 'handed_off'
       WHERE id = $1`,
      [input.deliveryId, input.handoffAt.toISOString()],
    );
    await this.db.query(
      `UPDATE app.shipments s
       SET status = 'handed_off'
       FROM app.shipment_deliveries d
       WHERE d.id = $1 AND d.shipment_id = s.id`,
      [input.deliveryId],
    );
    await this.audit.append({
      actorIdentityId: input.actorIdentityId,
      actorType: 'staff',
      action: 'delivery.handoff',
      targetType: 'shipment_delivery',
      targetId: input.deliveryId,
      correlationId: crypto.randomUUID(),
    });
  }

  async recordPod(input: {
    deliveryId: string;
    podMethod: 'otp' | 'signature' | 'photo' | 'api';
    evidenceKey?: string;
    deliveredAt: Date;
  }) {
    const row = await this.db.query<{
      courier_contract_id: string;
      pod_methods: string[];
    }>(
      `SELECT d.courier_contract_id, c.pod_methods
       FROM app.shipment_deliveries d
       JOIN app.courier_contracts c ON c.id = d.courier_contract_id
       WHERE d.id = $1`,
      [input.deliveryId],
    );
    if (!row.rows[0]) throw new Error('delivery_not_found');
    if (!row.rows[0].pod_methods.includes(input.podMethod)) {
      throw new Error('pod_method_not_allowed');
    }
    await this.db.query(
      `UPDATE app.shipment_deliveries
       SET pod_method = $2, pod_evidence_key = $3, delivered_at = $4, status = 'delivered'
       WHERE id = $1`,
      [
        input.deliveryId,
        input.podMethod,
        input.evidenceKey ?? null,
        input.deliveredAt.toISOString(),
      ],
    );
    await this.db.query(
      `UPDATE app.shipments s
       SET status = 'delivered'
       FROM app.shipment_deliveries d
       WHERE d.id = $1 AND d.shipment_id = s.id`,
      [input.deliveryId],
    );
  }

  async openClaim(input: {
    deliveryId: string;
    claimType: 'lost' | 'damaged';
    notes?: string;
  }) {
    const delivery = await this.db.query<{
      status: string;
      lost_liability_party: string;
      damaged_liability_party: string;
    }>(
      `SELECT d.status, c.lost_liability_party, c.damaged_liability_party
       FROM app.shipment_deliveries d
       JOIN app.courier_contracts c ON c.id = d.courier_contract_id
       WHERE d.id = $1`,
      [input.deliveryId],
    );
    if (!delivery.rows[0]) throw new Error('delivery_not_found');
    const openExisting = await this.db.query<{ id: string }>(
      `SELECT id FROM app.delivery_claims
       WHERE shipment_delivery_id = $1
         AND status IN ('open', 'platform_coordinating')
       LIMIT 1`,
      [input.deliveryId],
    );
    if (openExisting.rows[0]) throw new Error('claim_already_open');
    if (delivery.rows[0].status !== 'delivered') {
      throw new Error('delivery_not_delivered');
    }
    const liability =
      input.claimType === 'lost'
        ? delivery.rows[0].lost_liability_party
        : delivery.rows[0].damaged_liability_party;
    const claim = await this.db.query<{ id: string }>(
      `INSERT INTO app.delivery_claims
        (shipment_delivery_id, claim_type, status, liability_party, notes)
       VALUES ($1,$2,'platform_coordinating',$3,$4) RETURNING id`,
      [input.deliveryId, input.claimType, liability, input.notes ?? null],
    );
    await this.db.query(
      `UPDATE app.shipment_deliveries SET status = 'claim_open' WHERE id = $1`,
      [input.deliveryId],
    );
    return { claimId: claim.rows[0]!.id, liabilityParty: liability };
  }

  async listClaims(limit = 50) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      id: string;
      shipment_delivery_id: string;
      child_order_id: string;
      claim_type: string;
      status: string;
      liability_party: string | null;
      notes: string | null;
      delivery_status: string;
      tracking_number: string | null;
      created_at: string;
      resolved_at: string | null;
    }>(
      `SELECT c.id, c.shipment_delivery_id, d.child_order_id, c.claim_type, c.status,
              c.liability_party, c.notes, d.status AS delivery_status, d.tracking_number,
              c.created_at::text, c.resolved_at::text
       FROM app.delivery_claims c
       JOIN app.shipment_deliveries d ON d.id = c.shipment_delivery_id
       ORDER BY c.created_at DESC
       LIMIT $1`,
      [capped],
    );
    return rows.rows.map((r) => ({
      claimId: r.id,
      deliveryId: r.shipment_delivery_id,
      childOrderId: r.child_order_id,
      claimType: r.claim_type,
      status: r.status,
      liabilityParty: r.liability_party,
      notes: r.notes,
      deliveryStatus: r.delivery_status,
      trackingNumber: r.tracking_number,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
    }));
  }

  async resolveClaim(input: {
    claimId: string;
    status: 'resolved' | 'rejected';
    notes?: string;
  }) {
    const claim = await this.db.query<{
      id: string;
      status: string;
      shipment_delivery_id: string;
      notes: string | null;
    }>(
      `SELECT id, status, shipment_delivery_id, notes
       FROM app.delivery_claims WHERE id = $1`,
      [input.claimId],
    );
    if (!claim.rows[0]) throw new Error('claim_not_found');
    if (
      claim.rows[0].status !== 'open' &&
      claim.rows[0].status !== 'platform_coordinating'
    ) {
      throw new Error('claim_not_open');
    }
    const notes =
      input.notes?.trim() ||
      claim.rows[0].notes ||
      null;
    await this.db.query(
      `UPDATE app.delivery_claims
       SET status = $2, notes = $3, resolved_at = timezone('utc', now())
       WHERE id = $1`,
      [input.claimId, input.status, notes],
    );
    await this.db.query(
      `UPDATE app.shipment_deliveries
       SET status = 'delivered'
       WHERE id = $1 AND status = 'claim_open'`,
      [claim.rows[0].shipment_delivery_id],
    );
    return {
      claimId: input.claimId,
      status: input.status,
      deliveryId: claim.rows[0].shipment_delivery_id,
    };
  }
}
