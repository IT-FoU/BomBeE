import type { PGlite } from '@electric-sql/pglite';

export type NotificationProvider = {
  name: string;
  send: (input: {
    channel: 'in_app' | 'sms' | 'push' | 'email';
    destination: string;
    template: string;
    payload: Record<string, unknown>;
  }) => Promise<void>;
};

export class InMemoryProvider implements NotificationProvider {
  name = 'memory';
  readonly sent: Array<Record<string, unknown>> = [];
  failTimes = 0;

  async send(input: {
    channel: 'in_app' | 'sms' | 'push' | 'email';
    destination: string;
    template: string;
    payload: Record<string, unknown>;
  }) {
    if (this.failTimes > 0) {
      this.failTimes -= 1;
      throw new Error('provider_temporary_failure');
    }
    this.sent.push(input);
  }
}

export class NotificationDispatchService {
  constructor(
    private readonly db: PGlite,
    private readonly providers: Map<string, NotificationProvider>,
  ) {}

  async enqueue(input: {
    channel: 'in_app' | 'sms' | 'push' | 'email';
    provider: string;
    destination: string;
    template: string;
    title: string;
    body: string;
    recipientIdentityId?: string;
    actionLink?: string;
    payload?: Record<string, unknown>;
  }) {
    if (input.recipientIdentityId && input.channel === 'in_app') {
      await this.db.query(
        `INSERT INTO app.notification_inbox
          (recipient_identity_id, channel, template, title, body, action_link, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [
          input.recipientIdentityId,
          input.channel,
          input.template,
          input.title,
          input.body,
          input.actionLink ?? null,
          JSON.stringify(input.payload ?? {}),
        ],
      );
    }
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO app.notification_outbox
        (channel, provider, destination, template, payload)
       VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING id`,
      [
        input.channel,
        input.provider,
        input.destination,
        input.template,
        JSON.stringify(input.payload ?? {}),
      ],
    );
    return row.rows[0]!.id;
  }

  async processOutbox(now = new Date()) {
    const pending = await this.db.query<{
      id: string;
      channel: 'in_app' | 'sms' | 'push' | 'email';
      provider: string;
      destination: string;
      template: string;
      payload: Record<string, unknown>;
      attempts: number;
      max_attempts: number;
    }>(
      `SELECT id, channel, provider, destination, template, payload, attempts, max_attempts
       FROM app.notification_outbox
       WHERE status IN ('pending','failed') AND next_attempt_at <= $1
       ORDER BY created_at ASC LIMIT 50`,
      [now.toISOString()],
    );

    for (const job of pending.rows) {
      const provider = this.providers.get(job.provider);
      if (!provider) {
        await this.fail(job.id, job.attempts, job.max_attempts, 'provider_missing', now);
        continue;
      }
      try {
        await provider.send({
          channel: job.channel,
          destination: job.destination,
          template: job.template,
          payload: job.payload,
        });
        await this.db.query(
          `UPDATE app.notification_outbox
           SET status = 'sent', attempts = attempts + 1, sent_at = $2, last_error = NULL
           WHERE id = $1`,
          [job.id, now.toISOString()],
        );
      } catch (e) {
        await this.fail(
          job.id,
          job.attempts,
          job.max_attempts,
          e instanceof Error ? e.message : 'send_failed',
          now,
        );
      }
    }
  }

  async listInbox(recipientIdentityId: string) {
    const rows = await this.db.query<{
      id: string;
      title: string;
      body: string;
      action_link: string | null;
      read_at: string | null;
    }>(
      `SELECT id, title, body, action_link, read_at::text
       FROM app.notification_inbox
       WHERE recipient_identity_id = $1
       ORDER BY created_at DESC`,
      [recipientIdentityId],
    );
    return rows.rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      actionLink: r.action_link,
      read: r.read_at != null,
    }));
  }

  async markRead(inboxId: string, recipientIdentityId: string) {
    await this.db.query(
      `UPDATE app.notification_inbox SET read_at = timezone('utc', now())
       WHERE id = $1 AND recipient_identity_id = $2`,
      [inboxId, recipientIdentityId],
    );
  }

  private async fail(
    id: string,
    attempts: number,
    maxAttempts: number,
    error: string,
    now: Date,
  ) {
    const nextAttempts = attempts + 1;
    const dead = nextAttempts >= maxAttempts;
    await this.db.query(
      `UPDATE app.notification_outbox
       SET status = $2, attempts = $3, last_error = $4,
           next_attempt_at = $5
       WHERE id = $1`,
      [
        id,
        dead ? 'dead' : 'failed',
        nextAttempts,
        error,
        new Date(now.getTime() + 60_000).toISOString(),
      ],
    );
  }
}
