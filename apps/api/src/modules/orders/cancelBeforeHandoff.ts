import type { ApiServices } from '../../runtime/createServices.js';

export type CancelOrderResult = {
  previewId: string;
  cancelledChildIds: string[];
  releasedReservationIds: string[];
  cancelledPaymentRequestIds: string[];
  refundRequestId?: string;
};

/** Customer cancel before courier handoff; releases active reservations + open QR. */
export async function cancelOrderBeforeHandoff(
  services: ApiServices,
  parentId: string,
  actorIdentityId: string,
  scope: 'order' | 'store' = 'order',
  childOrderId?: string,
): Promise<CancelOrderResult> {
  const preview = await services.orders.previewCancellation({
    parentOrderId: parentId,
    scope,
    childOrderId,
  });

  const children = await services.db.query<{
    id: string;
    payment_received: boolean;
  }>(
    `SELECT id, payment_received FROM app.child_orders WHERE parent_order_id = $1`,
    [parentId],
  );
  const targetIds =
    scope === 'store' && childOrderId
      ? children.rows.filter((c) => c.id === childOrderId).map((c) => c.id)
      : children.rows.map((c) => c.id);
  const paymentReceived = children.rows.some(
    (c) => targetIds.includes(c.id) && c.payment_received,
  );

  const correlationId = crypto.randomUUID();
  const confirmed = await services.orders.confirmCancellation({
    parentOrderId: parentId,
    previewId: preview.previewId,
    scope,
    childOrderId,
    actorIdentityId,
    paymentReceived,
    correlationId,
  });
  if (!confirmed.ok) {
    throw new Error(confirmed.reason);
  }

  const releasedReservationIds: string[] = [];
  const cancelledPaymentRequestIds: string[] = [];

  for (const childId of targetIds) {
    const qrRows = await services.db.query<{ id: string }>(
      `SELECT r.id
       FROM app.order_items oi
       JOIN finance.payment_allocations pa ON pa.child_order_id = oi.child_order_id
       JOIN private.inventory_reservations r
         ON r.idempotency_key = ('qr:' || pa.payment_request_id::text || ':' || oi.id::text)
       WHERE oi.child_order_id = $1::uuid AND r.status = 'active'`,
      [childId],
    );
    const codRows = await services.db.query<{ id: string }>(
      `SELECT r.id
       FROM app.order_items oi
       JOIN private.inventory_reservations r
         ON r.idempotency_key = ('cod:' || oi.child_order_id::text || ':' || oi.id::text)
       WHERE oi.child_order_id = $1::uuid AND r.status = 'active'`,
      [childId],
    );
    const seen = new Set<string>();
    for (const row of [...qrRows.rows, ...codRows.rows]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const released = await services.reservations.release({
        reservationId: row.id,
        correlationId,
        reason: 'order_cancelled_before_handoff',
      });
      if (released.ok) releasedReservationIds.push(row.id);
    }

    const payments = await services.db.query<{ id: string }>(
      `SELECT pr.id
       FROM finance.payment_allocations pa
       JOIN finance.payment_requests pr ON pr.id = pa.payment_request_id
       WHERE pa.child_order_id = $1::uuid AND pr.status IN ('open', 'partially_paid')`,
      [childId],
    );
    for (const payment of payments.rows) {
      await services.db.query(
        `UPDATE finance.payment_requests SET status = 'cancelled' WHERE id = $1::uuid`,
        [payment.id],
      );
      cancelledPaymentRequestIds.push(payment.id);
    }

    await services.db.query(
      `UPDATE finance.cod_shipments SET status = 'failed'
       WHERE child_order_id = $1::uuid AND status = 'open'`,
      [childId],
    );
  }

  return {
    previewId: preview.previewId,
    cancelledChildIds: targetIds,
    releasedReservationIds,
    cancelledPaymentRequestIds: [...new Set(cancelledPaymentRequestIds)],
    ...(confirmed.refundRequestId ? { refundRequestId: confirmed.refundRequestId } : {}),
  };
}
