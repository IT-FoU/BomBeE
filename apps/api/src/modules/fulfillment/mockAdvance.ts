import { ManualCourierAdapter } from './deliveryService.js';
import type { ApiServices } from '../../runtime/createServices.js';
import type { ChildStatus } from '../orders/stateMachine.js';

export type MockAdvanceChildResult = {
  childOrderId: string;
  from: string;
  to: string;
  steps: string[];
  trackingNumber?: string;
  consumedReservationIds?: string[];
};

export type MockDeliverChildResult = {
  childOrderId: string;
  from: string;
  to: string;
  steps: string[];
  deliveryId?: string;
};

async function consumeReservationsForChild(
  services: ApiServices,
  childOrderId: string,
  correlationId: string,
): Promise<string[]> {
  const qrRows = await services.db.query<{ id: string; status: string }>(
    `SELECT r.id, r.status
     FROM app.order_items oi
     JOIN finance.payment_allocations pa ON pa.child_order_id = oi.child_order_id
     JOIN private.inventory_reservations r
       ON r.idempotency_key = ('qr:' || pa.payment_request_id::text || ':' || oi.id::text)
     WHERE oi.child_order_id = $1
       AND oi.status = 'active'`,
    [childOrderId],
  );
  const codRows = await services.db.query<{ id: string; status: string }>(
    `SELECT r.id, r.status
     FROM app.order_items oi
     JOIN private.inventory_reservations r
       ON r.idempotency_key = ('cod:' || oi.child_order_id::text || ':' || oi.id::text)
     WHERE oi.child_order_id = $1
       AND oi.status = 'active'`,
    [childOrderId],
  );
  const consumed: string[] = [];
  const seen = new Set<string>();
  for (const row of [...qrRows.rows, ...codRows.rows]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    if (row.status !== 'active' && row.status !== 'consumed') continue;
    const result = await services.reservations.consume({
      reservationId: row.id,
      correlationId,
      reason: 'ship_handoff',
    });
    if (result.ok) consumed.push(row.id);
  }
  return consumed;
}

/** Local/mock: advance paid children awaiting_payment → … → in_transit (consume at handoff). */
export async function mockAdvanceFulfillment(
  services: ApiServices,
  parentId: string,
  actorIdentityId: string,
): Promise<MockAdvanceChildResult[]> {
  const courier = await services.db.query<{ id: string }>(
    `SELECT id FROM app.couriers WHERE code = 'LOCAL-MOCK' LIMIT 1`,
  );
  if (!courier.rows[0]) {
    throw new Error('mock_courier_missing');
  }
  const courierId = courier.rows[0].id;

  const children = await services.db.query<{
    id: string;
    status: string;
    payment_received: boolean;
  }>(
    `SELECT id, status, payment_received
     FROM app.child_orders
     WHERE parent_order_id = $1
     ORDER BY child_order_number`,
    [parentId],
  );

  const results: MockAdvanceChildResult[] = [];

  for (const child of children.rows) {
    const codEligible = child.status === 'awaiting_cod';
    if (!child.payment_received && !codEligible) {
      results.push({
        childOrderId: child.id,
        from: child.status,
        to: child.status,
        steps: ['skipped_unpaid'],
      });
      continue;
    }

    const steps: string[] = [];
    let status = child.status as ChildStatus;
    const from = status;
    let trackingNumber: string | undefined;
    let consumedReservationIds: string[] | undefined;

    while (
      status === 'awaiting_payment' ||
      status === 'awaiting_cod' ||
      status === 'packing' ||
      status === 'ready' ||
      status === 'handed_to_courier'
    ) {
      if (status === 'awaiting_payment' || status === 'awaiting_cod') {
        const now = new Date();
        await services.delivery.schedulePackingDeadline(child.id, now);
        const result = await services.orders.transitionChild({
          childOrderId: child.id,
          toStatus: 'packing',
          actorIdentityId,
          reason: 'local_mock_fulfillment',
          correlationId: crypto.randomUUID(),
        });
        if (!result.ok) {
          steps.push(`failed:${result.reason}`);
          break;
        }
        steps.push('packing');
        status = 'packing';
        continue;
      }

      if (status === 'packing') {
        const now = new Date();
        await services.delivery.schedulePackingDeadline(child.id, now);
        await services.delivery.markPacked(child.id, now);
        const result = await services.orders.transitionChild({
          childOrderId: child.id,
          toStatus: 'ready',
          actorIdentityId,
          reason: 'local_mock_fulfillment',
          correlationId: crypto.randomUUID(),
        });
        if (!result.ok) {
          steps.push(`failed:${result.reason}`);
          break;
        }
        steps.push('ready');
        status = 'ready';
        continue;
      }

      if (status === 'ready') {
        const existing = await services.db.query<{ id: string; tracking_number: string }>(
          `SELECT id, tracking_number FROM app.shipment_deliveries
           WHERE child_order_id = $1
           ORDER BY created_at DESC LIMIT 1`,
          [child.id],
        );
        if (existing.rows[0]) {
          trackingNumber = existing.rows[0].tracking_number;
        } else {
          const created = await services.delivery.createDelivery({
            childOrderId: child.id,
            courierId,
            channel: 'manual',
            adapter: new ManualCourierAdapter(),
            packagePhotoKey: `mock/pkg/${child.id}.jpg`,
            trackingHint: `MOCK-${child.id.replace(/-/g, '').slice(0, 12)}`,
            actorIdentityId,
          });
          trackingNumber = created.trackingNumber;
        }
        const result = await services.orders.transitionChild({
          childOrderId: child.id,
          toStatus: 'handed_to_courier',
          actorIdentityId,
          reason: 'local_mock_fulfillment',
          correlationId: crypto.randomUUID(),
        });
        if (!result.ok) {
          steps.push(`failed:${result.reason}`);
          break;
        }
        steps.push('handed_to_courier');
        status = 'handed_to_courier';
        continue;
      }

      if (status === 'handed_to_courier') {
        const delivery = await services.db.query<{
          id: string;
          tracking_number: string;
          status: string;
        }>(
          `SELECT id, tracking_number, status FROM app.shipment_deliveries
           WHERE child_order_id = $1
           ORDER BY created_at DESC LIMIT 1`,
          [child.id],
        );
        const row = delivery.rows[0];
        if (!row) {
          steps.push('failed:delivery_missing');
          break;
        }
        trackingNumber = row.tracking_number;
        if (row.status === 'created') {
          await services.delivery.handoff({
            deliveryId: row.id,
            handoffAt: new Date(),
            actorIdentityId,
          });
        }
        const correlationId = crypto.randomUUID();
        consumedReservationIds = await consumeReservationsForChild(
          services,
          child.id,
          correlationId,
        );
        if (consumedReservationIds.length > 0) {
          steps.push(`consumed:${consumedReservationIds.length}`);
        }
        const result = await services.orders.transitionChild({
          childOrderId: child.id,
          toStatus: 'in_transit',
          actorIdentityId,
          reason: 'local_mock_fulfillment',
          correlationId,
        });
        if (!result.ok) {
          steps.push(`failed:${result.reason}`);
          break;
        }
        steps.push('in_transit');
        status = 'in_transit';
        break;
      }
    }

    if (steps.length === 0) {
      steps.push(status === 'in_transit' ? 'already_in_transit' : 'no_op');
    }

    results.push({
      childOrderId: child.id,
      from,
      to: status,
      steps,
      ...(trackingNumber ? { trackingNumber } : {}),
      ...(consumedReservationIds?.length ? { consumedReservationIds } : {}),
    });
  }

  return results;
}

/** Local/mock: POD + delivered for in_transit children. */
export async function mockDeliverFulfillment(
  services: ApiServices,
  parentId: string,
  actorIdentityId: string,
): Promise<MockDeliverChildResult[]> {
  const children = await services.db.query<{
    id: string;
    status: string;
    payment_received: boolean;
  }>(
    `SELECT id, status, payment_received
     FROM app.child_orders
     WHERE parent_order_id = $1
     ORDER BY child_order_number`,
    [parentId],
  );

  const results: MockDeliverChildResult[] = [];

  for (const child of children.rows) {
    const from = child.status;
    if (child.status === 'delivered') {
      results.push({
        childOrderId: child.id,
        from,
        to: 'delivered',
        steps: ['already_delivered'],
      });
      continue;
    }
    if (child.status !== 'in_transit') {
      results.push({
        childOrderId: child.id,
        from,
        to: child.status,
        steps: ['skipped_not_in_transit'],
      });
      continue;
    }

    const delivery = await services.db.query<{ id: string }>(
      `SELECT id FROM app.shipment_deliveries
       WHERE child_order_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [child.id],
    );
    const row = delivery.rows[0];
    if (!row) {
      results.push({
        childOrderId: child.id,
        from,
        to: child.status,
        steps: ['failed:delivery_missing'],
      });
      continue;
    }

    const steps: string[] = [];
    await services.delivery.recordPod({
      deliveryId: row.id,
      podMethod: 'signature',
      evidenceKey: `mock/pod/${child.id}.png`,
      deliveredAt: new Date(),
    });
    steps.push('pod');

    await services.db.query(
      `UPDATE app.child_orders
       SET payment_received = true, updated_at = timezone('utc', now())
       WHERE id = $1 AND payment_received = false`,
      [child.id],
    );
    await services.db.query(
      `UPDATE finance.cod_shipments
       SET status = 'collected'
       WHERE child_order_id = $1 AND status = 'open'`,
      [child.id],
    );

    const result = await services.orders.transitionChild({
      childOrderId: child.id,
      toStatus: 'delivered',
      actorIdentityId,
      reason: 'local_mock_pod',
      correlationId: crypto.randomUUID(),
    });
    if (!result.ok) {
      results.push({
        childOrderId: child.id,
        from,
        to: child.status,
        steps: [...steps, `failed:${result.reason}`],
        deliveryId: row.id,
      });
      continue;
    }
    steps.push('delivered');
    results.push({
      childOrderId: child.id,
      from,
      to: 'delivered',
      steps,
      deliveryId: row.id,
    });
  }

  return results;
}
