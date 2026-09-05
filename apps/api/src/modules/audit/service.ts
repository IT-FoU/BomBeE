import type { PGlite } from '@electric-sql/pglite';

import { createAuditEvent, type AuditEventInput } from './audit.js';

export class AuditService {
  constructor(private readonly db: PGlite) {}

  async append(input: AuditEventInput): Promise<string> {
    const event = createAuditEvent(crypto.randomUUID(), input);
    await this.db.query(
      `INSERT INTO security.audit_events
        (id, actor_identity_id, actor_type, action, target_type, target_id,
         before_state, after_state, reason, ip, device_id, correlation_id, retain_until)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13)`,
      [
        event.id,
        input.actorIdentityId ?? null,
        input.actorType,
        input.action,
        input.targetType,
        input.targetId ?? null,
        input.beforeState ? JSON.stringify(input.beforeState) : null,
        input.afterState ? JSON.stringify(input.afterState) : null,
        input.reason ?? null,
        input.ip ?? null,
        input.deviceId ?? null,
        input.correlationId,
        event.retainUntil.toISOString().slice(0, 10),
      ],
    );
    return event.id;
  }

  async logCustomerPiiAccess(input: {
    actorIdentityId: string;
    customerProfileId: string;
    fields: string[];
    reason: string;
    correlationId: string;
  }) {
    await this.db.query(
      `INSERT INTO security.customer_pii_access_logs
        (actor_identity_id, customer_profile_id, fields, reason, correlation_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        input.actorIdentityId,
        input.customerProfileId,
        input.fields,
        input.reason,
        input.correlationId,
      ],
    );
    await this.append({
      actorIdentityId: input.actorIdentityId,
      actorType: 'staff',
      action: 'customers.read_pii',
      targetType: 'customer_profile',
      targetId: input.customerProfileId,
      reason: input.reason,
      correlationId: input.correlationId,
      afterState: { fields: input.fields },
    });
  }

  async tryMutate(kind: 'update' | 'delete'): Promise<{ blocked: boolean }> {
    try {
      if (kind === 'update') {
        await this.db.query(`UPDATE security.audit_events SET reason = 'tamper' WHERE false`);
        // Attempt real mutation on latest row if any
        await this.db.exec(`UPDATE security.audit_events SET reason = 'tamper'`);
      } else {
        await this.db.exec(`DELETE FROM security.audit_events`);
      }
      return { blocked: false };
    } catch {
      return { blocked: true };
    }
  }

  async listRecent(limit = 50) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      id: string;
      actor_identity_id: string | null;
      actor_type: string;
      action: string;
      target_type: string;
      target_id: string | null;
      reason: string | null;
      correlation_id: string;
      created_at: string;
    }>(
      `SELECT id, actor_identity_id, actor_type, action, target_type, target_id,
              reason, correlation_id::text, created_at::text
       FROM security.audit_events
       ORDER BY created_at DESC
       LIMIT $1`,
      [capped],
    );
    return rows.rows.map((r) => ({
      eventId: r.id,
      actorIdentityId: r.actor_identity_id,
      actorType: r.actor_type,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      reason: r.reason,
      correlationId: r.correlation_id,
      createdAt: r.created_at,
    }));
  }

  async listCustomerPiiAccessLogs(limit = 50) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const rows = await this.db.query<{
      id: string;
      actor_identity_id: string;
      customer_profile_id: string;
      fields: string[];
      reason: string;
      correlation_id: string;
      created_at: string;
    }>(
      `SELECT id, actor_identity_id, customer_profile_id, fields, reason,
              correlation_id::text, created_at::text
       FROM security.customer_pii_access_logs
       ORDER BY created_at DESC
       LIMIT $1`,
      [capped],
    );
    return rows.rows.map((r) => ({
      logId: r.id,
      actorIdentityId: r.actor_identity_id,
      customerProfileId: r.customer_profile_id,
      fields: r.fields,
      reason: r.reason,
      correlationId: r.correlation_id,
      createdAt: r.created_at,
    }));
  }
}
