import type { PGlite } from '@electric-sql/pglite';

import { NotificationBus } from '../notifications/bus.js';
import { addBusinessDays } from '../fulfillment/rules.js';

export const SUPPORT_AUTO_CLOSE_DAYS = 3;

export function firstResponseDue(createdAt: Date): Date {
  // same calendar day UTC end
  return new Date(
    Date.UTC(
      createdAt.getUTCFullYear(),
      createdAt.getUTCMonth(),
      createdAt.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  );
}

export function resolutionDue(createdAt: Date, urgency: 'general' | 'urgent'): Date {
  return addBusinessDays(createdAt, urgency === 'urgent' ? 3 : 7);
}

export class SupportService {
  constructor(
    private readonly db: PGlite,
    private readonly notifications = new NotificationBus(),
  ) {}

  async openTicket(input: {
    customerIdentityId: string;
    channel: 'in_app' | 'whatsapp' | 'phone';
    subject: string;
    body: string;
    urgency?: 'general' | 'urgent';
    externalRef?: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const urgency = input.urgency ?? 'general';
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO app.support_tickets
        (customer_identity_id, channel, external_ref, subject, urgency,
         first_response_due_at, resolution_due_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        input.customerIdentityId,
        input.channel,
        input.externalRef ?? null,
        input.subject,
        urgency,
        firstResponseDue(now).toISOString(),
        resolutionDue(now, urgency).toISOString(),
      ],
    );
    await this.db.query(
      `INSERT INTO app.support_messages (ticket_id, sender_type, sender_identity_id, body)
       VALUES ($1,'customer',$2,$3)`,
      [row.rows[0]!.id, input.customerIdentityId, input.body],
    );
    if (urgency === 'urgent') {
      await this.notifications.publish({
        channel: 'in_app',
        toRole: 'owner',
        template: 'support.urgent',
        payload: { ticketId: row.rows[0]!.id, roles: ['team_lead', 'finance'] },
      });
      await this.db.query(
        `INSERT INTO app.support_escalations (ticket_id, reason, notified_roles)
         VALUES ($1,'urgent_open',ARRAY['team_lead','finance'])`,
        [row.rows[0]!.id],
      );
    }
    return {
      ticketId: row.rows[0]!.id,
      firstResponseDueAt: firstResponseDue(now).toISOString(),
      resolutionDueAt: resolutionDue(now, urgency).toISOString(),
    };
  }

  async staffReply(input: {
    ticketId: string;
    staffIdentityId: string;
    body: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    await this.db.query(
      `INSERT INTO app.support_messages (ticket_id, sender_type, sender_identity_id, body)
       VALUES ($1,'staff',$2,$3)`,
      [input.ticketId, input.staffIdentityId, input.body],
    );
    await this.db.query(
      `UPDATE app.support_tickets
       SET first_responded_at = coalesce(first_responded_at, $2),
           status = 'awaiting_customer'
       WHERE id = $1`,
      [input.ticketId, now.toISOString()],
    );
  }

  async markPreliminaryResolved(ticketId: string, now = new Date()) {
    await this.db.query(
      `UPDATE app.support_tickets
       SET preliminary_resolved_at = $2, status = 'resolved_pending_confirm'
       WHERE id = $1`,
      [ticketId, now.toISOString()],
    );
  }

  async evaluateSla(ticketId: string, now = new Date()) {
    const row = await this.db.query<{
      first_response_due_at: string;
      resolution_due_at: string;
      first_responded_at: string | null;
      preliminary_resolved_at: string | null;
      escalated_at: string | null;
      urgency: string;
    }>(
      `SELECT first_response_due_at::text, resolution_due_at::text,
              first_responded_at::text, preliminary_resolved_at::text,
              escalated_at::text, urgency
       FROM app.support_tickets WHERE id = $1`,
      [ticketId],
    );
    const t = row.rows[0];
    if (!t) throw new Error('ticket_not_found');
    const breaches: string[] = [];
    if (!t.first_responded_at && now.getTime() > Date.parse(t.first_response_due_at)) {
      breaches.push('first_response');
    }
    if (!t.preliminary_resolved_at && now.getTime() > Date.parse(t.resolution_due_at)) {
      breaches.push('resolution');
    }
    if (breaches.length > 0 && !t.escalated_at) {
      await this.db.query(
        `UPDATE app.support_tickets SET escalated_at = $2 WHERE id = $1`,
        [ticketId, now.toISOString()],
      );
      await this.db.query(
        `INSERT INTO app.support_escalations (ticket_id, reason, notified_roles)
         VALUES ($1,$2,ARRAY['team_lead'])`,
        [ticketId, `sla_breach:${breaches.join(',')}`],
      );
      await this.notifications.publish({
        channel: 'in_app',
        toRole: 'owner',
        template: 'support.sla_breach',
        payload: { ticketId, breaches },
      });
    }
    return { breaches, escalated: breaches.length > 0 };
  }

  async customerConfirmClose(ticketId: string, now = new Date()) {
    await this.db.query(
      `UPDATE app.support_tickets SET status = 'closed', closed_at = $2 WHERE id = $1`,
      [ticketId, now.toISOString()],
    );
  }

  async autoCloseIfStale(ticketId: string, now = new Date()) {
    const row = await this.db.query<{
      status: string;
      preliminary_resolved_at: string | null;
    }>(`SELECT status, preliminary_resolved_at::text FROM app.support_tickets WHERE id = $1`, [
      ticketId,
    ]);
    const t = row.rows[0];
    if (!t || t.status !== 'resolved_pending_confirm' || !t.preliminary_resolved_at) {
      return { closed: false };
    }
    const due =
      Date.parse(t.preliminary_resolved_at) + SUPPORT_AUTO_CLOSE_DAYS * 24 * 60 * 60_000;
    if (now.getTime() < due) return { closed: false };
    await this.db.query(
      `UPDATE app.support_tickets SET status = 'closed', closed_at = $2 WHERE id = $1`,
      [ticketId, now.toISOString()],
    );
    return { closed: true };
  }

  async reopen(ticketId: string, customerIdentityId: string, body: string) {
    await this.db.query(
      `UPDATE app.support_tickets SET status = 'reopened', closed_at = NULL WHERE id = $1`,
      [ticketId],
    );
    await this.db.query(
      `INSERT INTO app.support_messages (ticket_id, sender_type, sender_identity_id, body)
       VALUES ($1,'customer',$2,$3)`,
      [ticketId, customerIdentityId, body],
    );
  }
}
