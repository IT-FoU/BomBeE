import type { ApiServices } from '../../runtime/createServices.js';

export type MockExpireDueResult = {
  payments: Array<{
    paymentRequestId: string;
    ok: boolean;
    status?: string;
    reason?: string;
    releasedReservationIds: string[];
    cancelledChildIds: string[];
  }>;
  reservations: Array<{ reservationId: string; status?: string; ok?: boolean }>;
};

/** Local/mock: expire due QR payments (release stock, cancel awaiting children) + grace reservations. */
export async function mockExpireDue(
  services: ApiServices,
  now = new Date(),
  actorIdentityId?: string,
): Promise<MockExpireDueResult> {
  const paymentsRaw = await services.payments.expireDueOpenRequests(now);
  const payments: MockExpireDueResult['payments'] = [];

  for (const payment of paymentsRaw) {
    const releasedReservationIds: string[] = [];
    const cancelledChildIds: string[] = [];
    if (payment.ok && payment.status === 'expired') {
      const correlationId = crypto.randomUUID();
      const rows = await services.db.query<{ id: string }>(
        `SELECT id FROM private.inventory_reservations
         WHERE status = 'active'
           AND idempotency_key LIKE $1`,
        [`qr:${payment.paymentRequestId}:%`],
      );
      for (const row of rows.rows) {
        const released = await services.reservations.release({
          reservationId: row.id,
          correlationId,
          reason: 'qr_payment_expired',
          finalStatus: 'expired',
        });
        if (released.ok) releasedReservationIds.push(row.id);
      }

      if (actorIdentityId) {
        const children = await services.db.query<{ id: string; status: string }>(
          `SELECT co.id, co.status
           FROM finance.payment_allocations pa
           JOIN app.child_orders co ON co.id = pa.child_order_id
           WHERE pa.payment_request_id = $1`,
          [payment.paymentRequestId],
        );
        for (const child of children.rows) {
          if (child.status !== 'awaiting_payment') continue;
          const result = await services.orders.transitionChild({
            childOrderId: child.id,
            toStatus: 'cancelled',
            actorIdentityId,
            reason: 'qr_payment_expired',
            correlationId: crypto.randomUUID(),
          });
          if (result.ok) cancelledChildIds.push(child.id);
        }
      }
    }
    payments.push({ ...payment, releasedReservationIds, cancelledChildIds });
  }

  const reservations = await services.reservations.expireDue(now.getTime());
  return {
    payments,
    reservations: reservations.map((r) => ({
      reservationId: r.reservationId,
      ok: r.ok,
      ...(r.ok ? { status: r.status } : {}),
    })),
  };
}
