import { ManualCourierAdapter } from './deliveryService.js';
import type { ApiServices } from '../../runtime/createServices.js';
import type { ChildStatus } from '../orders/stateMachine.js';

export type MockAdvanceChildResult = {
  childOrderId: string;
  from: string;
  to: string;
  steps: string[];
  trackingNumber?: string;
};

/** Local/mock: advance paid children awaiting_payment → … → in_transit. */
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
    if (!child.payment_received) {
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

    while (status === 'awaiting_payment' || status === 'packing' || status === 'ready' || status === 'handed_to_courier') {
      if (status === 'awaiting_payment') {
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
        const delivery = await services.db.query<{ id: string; tracking_number: string; status: string }>(
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
        const result = await services.orders.transitionChild({
          childOrderId: child.id,
          toStatus: 'in_transit',
          actorIdentityId,
          reason: 'local_mock_fulfillment',
          correlationId: crypto.randomUUID(),
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
    });
  }

  return results;
}
