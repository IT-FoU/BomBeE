import type { ApiServices } from '../../runtime/createServices.js';

export type MockExpireDueResult = {
  payments: Array<{
    paymentRequestId: string;
    ok: boolean;
    status?: string;
    reason?: string;
    releasedReservationIds: string[];
  }>;
  reservations: Array<{ reservationId: string; status?: string; ok?: boolean }>;
};

/** Local/mock: expire due QR payments (release stock) + grace-expired reservations. */
export async function mockExpireDue(
  services: ApiServices,
  now = new Date(),
): Promise<MockExpireDueResult> {
  const paymentsRaw = await services.payments.expireDueOpenRequests(now);
  const payments: MockExpireDueResult['payments'] = [];

  for (const payment of paymentsRaw) {
    const releasedReservationIds: string[] = [];
    if (payment.ok && payment.status === 'expired') {
      const rows = await services.db.query<{ id: string }>(
        `SELECT id FROM private.inventory_reservations
         WHERE status = 'active'
           AND idempotency_key LIKE $1`,
        [`qr:${payment.paymentRequestId}:%`],
      );
      const correlationId = crypto.randomUUID();
      for (const row of rows.rows) {
        const released = await services.reservations.release({
          reservationId: row.id,
          correlationId,
          reason: 'qr_payment_expired',
          finalStatus: 'expired',
        });
        if (released.ok) releasedReservationIds.push(row.id);
      }
    }
    payments.push({ ...payment, releasedReservationIds });
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
