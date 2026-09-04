import type { PGlite } from '@electric-sql/pglite';

export const EGO_STALE_STOCK_MS = 30 * 60_000;
export const EGO_MAX_RETRIES = 5;

export type EgoNetwork = {
  /** Real network is forbidden when flag is off — mock only. */
  post: (url: string, body: unknown) => Promise<{ ok: boolean; status: number }>;
};

export class BlockedEgoNetwork implements EgoNetwork {
  readonly calls: Array<{ url: string; body: unknown }> = [];
  async post(url: string, body: unknown): Promise<{ ok: boolean; status: number }> {
    this.calls.push({ url, body });
    throw new Error('ego_network_blocked_flag_off');
  }
}

export class MockEgoNetwork implements EgoNetwork {
  failUntil = 0;
  async post(_url: string, _body: unknown) {
    if (this.failUntil > 0) {
      this.failUntil -= 1;
      return { ok: false, status: 503 };
    }
    return { ok: true, status: 200 };
  }
}

export class EgoIntegrationService {
  constructor(
    private readonly db: PGlite,
    private readonly featureFlagEnabled: boolean,
    private readonly network: EgoNetwork = new BlockedEgoNetwork(),
  ) {}

  async ensureProfile(storeId: string) {
    const existing = await this.db.query<{ id: string; status: string }>(
      `SELECT id, status FROM integrations.ego_profiles WHERE store_id = $1`,
      [storeId],
    );
    if (existing.rows[0]) return existing.rows[0];
    const row = await this.db.query<{ id: string; status: string }>(
      `INSERT INTO integrations.ego_profiles (store_id, status, feature_flag_on, credentials_configured)
       VALUES ($1,'disabled',false,false) RETURNING id, status`,
      [storeId],
    );
    return row.rows[0]!;
  }

  integrationCenterStatus(storeId: string) {
    return this.db
      .query<{
        status: string;
        feature_flag_on: boolean;
        credentials_configured: boolean;
        source_of_truth: string;
      }>(
        `SELECT status, feature_flag_on, credentials_configured, source_of_truth
         FROM integrations.ego_profiles WHERE store_id = $1`,
        [storeId],
      )
      .then((r) => {
        const row = r.rows[0];
        if (!row) {
          return {
            display: 'Disabled/Not configured' as const,
            status: 'disabled' as const,
            featureFlagOn: false,
            credentialsConfigured: false,
          };
        }
        return {
          display: 'Disabled/Not configured' as const,
          status: row.status,
          featureFlagOn: row.feature_flag_on,
          credentialsConfigured: row.credentials_configured,
          sourceOfTruth: row.source_of_truth,
        };
      });
  }

  async setSourceOfTruth(storeId: string, source: 'marketplace' | 'ego') {
    await this.ensureProfile(storeId);
    await this.db.query(
      `UPDATE integrations.ego_profiles SET source_of_truth = $2 WHERE store_id = $1`,
      [storeId, source],
    );
  }

  async suggestMapping(input: {
    storeId: string;
    marketplaceVariantId: string;
    suggestedExternalId: string;
  }) {
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO integrations.ego_mappings
        (store_id, marketplace_variant_id, suggested_external_id, status)
       VALUES ($1,$2,$3,'suggested')
       ON CONFLICT (store_id, marketplace_variant_id)
       DO UPDATE SET suggested_external_id = EXCLUDED.suggested_external_id, status = 'suggested'
       RETURNING id`,
      [input.storeId, input.marketplaceVariantId, input.suggestedExternalId],
    );
    return row.rows[0]!.id;
  }

  async approveMapping(input: {
    mappingId: string;
    approverIdentityId: string;
  }) {
    await this.db.query(
      `UPDATE integrations.ego_mappings
       SET status = 'approved',
           approved_external_id = suggested_external_id,
           approved_by = $2,
           approved_at = timezone('utc', now())
       WHERE id = $1`,
      [input.mappingId, input.approverIdentityId],
    );
  }

  /** Mock-only: EGO → Marketplace product/stock event. */
  async ingestFromEgoMock(input: {
    storeId: string;
    eventType: 'product' | 'stock';
    externalId: string;
    payload: Record<string, unknown>;
    stockObservedAt?: Date;
  }) {
    const idempotencyKey = `ego:${input.storeId}:${input.eventType}:${input.externalId}`;
    const correlationId = crypto.randomUUID();
    await this.db.query(
      `INSERT INTO integrations.ego_inbox
        (store_id, external_id, idempotency_key, correlation_id, direction, event_type, payload)
       VALUES ($1,$2,$3,$4,'ego_to_market',$5,$6::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        input.storeId,
        input.externalId,
        idempotencyKey,
        correlationId,
        input.eventType,
        JSON.stringify(input.payload),
      ],
    );
    if (input.eventType === 'stock' && input.stockObservedAt) {
      const age = Date.now() - input.stockObservedAt.getTime();
      if (age > EGO_STALE_STOCK_MS) {
        await this.db.query(
          `UPDATE app.stores SET can_accept_orders = false WHERE id = $1`,
          [input.storeId],
        );
        return { staleStock: true as const, orderingDisabled: true as const };
      }
    }
    return { staleStock: false as const };
  }

  /** Marketplace → EGO order; blocked when flag OFF (Phase 1 always). */
  async enqueueOrderToEgo(input: {
    storeId: string;
    orderId: string;
    payload: Record<string, unknown>;
  }) {
    const idempotencyKey = `mkt-order:${input.orderId}`;
    const correlationId = crypto.randomUUID();
    const status = this.featureFlagEnabled ? 'pending' : 'blocked_flag_off';
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO integrations.ego_outbox
        (store_id, external_id, idempotency_key, correlation_id, direction, event_type, payload, status)
       VALUES ($1,$2,$3,$4,'market_to_ego','order',$5::jsonb,$6)
       ON CONFLICT (idempotency_key) DO UPDATE SET payload = EXCLUDED.payload
       RETURNING id`,
      [
        input.storeId,
        input.orderId,
        idempotencyKey,
        correlationId,
        JSON.stringify(input.payload),
        status,
      ],
    );
    if (!this.featureFlagEnabled) {
      return { outboxId: row.rows[0]!.id, sent: false as const, reason: 'flag_off' as const };
    }
    return { outboxId: row.rows[0]!.id, sent: false as const, reason: 'queued' as const };
  }

  async dispatchOutbox(outboxId: string) {
    if (!this.featureFlagEnabled) {
      return { ok: false as const, reason: 'flag_off' as const, networkCalls: 0 };
    }
    const job = await this.db.query<{
      id: string;
      payload: unknown;
      status: string;
    }>(`SELECT id, payload, status FROM integrations.ego_outbox WHERE id = $1`, [outboxId]);
    if (!job.rows[0]) throw new Error('outbox_not_found');

    for (let attempt = 1; attempt <= EGO_MAX_RETRIES; attempt++) {
      const result = await this.network.post('mock://ego/orders', job.rows[0].payload);
      await this.db.query(
        `INSERT INTO integrations.ego_attempts (outbox_id, attempt_no, ok, error)
         VALUES ($1,$2,$3,$4)`,
        [outboxId, attempt, result.ok, result.ok ? null : `http_${result.status}`],
      );
      if (result.ok) {
        await this.db.query(
          `UPDATE integrations.ego_outbox SET status = 'sent' WHERE id = $1`,
          [outboxId],
        );
        return { ok: true as const, attempts: attempt };
      }
    }
    await this.db.query(
      `UPDATE integrations.ego_outbox SET status = 'failed' WHERE id = $1`,
      [outboxId],
    );
    await this.db.query(
      `INSERT INTO integrations.ego_error_queue (outbox_id, reason)
       VALUES ($1,'max_retries_exceeded')
       ON CONFLICT (outbox_id) DO NOTHING`,
      [outboxId],
    );
    return { ok: false as const, reason: 'error_queue' as const, attempts: EGO_MAX_RETRIES };
  }

  async mockOutageDisableOrdering(storeId: string) {
    await this.db.query(`UPDATE app.stores SET can_accept_orders = false WHERE id = $1`, [
      storeId,
    ]);
  }

  async mockFullSyncAndReopen(storeId: string, now = new Date()) {
    await this.db.query(
      `UPDATE integrations.ego_profiles
       SET last_full_sync_at = $2, last_health_at = $2
       WHERE store_id = $1`,
      [storeId, now.toISOString()],
    );
    await this.db.query(`UPDATE app.stores SET can_accept_orders = true WHERE id = $1`, [
      storeId,
    ]);
  }

  async listStoreStatuses(limit = 50) {
    const capped = Math.min(Math.max(limit, 1), 100);
    const stores = await this.db.query<{
      id: string;
      code: string;
      name: string;
      can_accept_orders: boolean;
    }>(
      `SELECT id, code, name, can_accept_orders
       FROM app.stores
       WHERE status = 'active'
       ORDER BY code ASC
       LIMIT $1`,
      [capped],
    );
    const rows = [];
    for (const store of stores.rows) {
      const ego = await this.integrationCenterStatus(store.id);
      rows.push({
        storeId: store.id,
        storeCode: store.code,
        storeName: store.name,
        canAcceptOrders: store.can_accept_orders,
        egoDisplay: ego.display,
        egoStatus: ego.status,
        featureFlagOn: ego.featureFlagOn,
        credentialsConfigured: ego.credentialsConfigured,
      });
    }
    return rows;
  }

  async ensureProfilesForActiveStores() {
    const stores = await this.db.query<{ id: string }>(
      `SELECT id FROM app.stores WHERE status = 'active'`,
    );
    const profiles = [];
    for (const store of stores.rows) {
      const profile = await this.ensureProfile(store.id);
      profiles.push({ storeId: store.id, profileId: profile.id, status: profile.status });
    }
    return profiles;
  }

  assertNoProductionTraffic() {
    if (this.featureFlagEnabled) throw new Error('ego_must_be_disabled_phase1');
    if (!(this.network instanceof BlockedEgoNetwork)) {
      // production path must use blocked network when flag off
    }
    return { egoPosEnabled: false, canSendTraffic: false };
  }
}
