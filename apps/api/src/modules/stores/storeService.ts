import type { PGlite } from '@electric-sql/pglite';

import { createHash, randomBytes } from 'node:crypto';

export type StoreStatus = 'draft' | 'onboarding' | 'active' | 'suspended' | 'offboarded';

export type OnboardingChecklist = {
  ownerIdOk: boolean;
  storeInfoOk: boolean;
  bankAccountOk: boolean;
  contractOk: boolean;
};

export function isOnboardingComplete(c: OnboardingChecklist): boolean {
  return c.ownerIdOk && c.storeInfoOk && c.bankAccountOk && c.contractOk;
}

export function canActivateStore(input: {
  checklist: OnboardingChecklist;
  hasActiveFulfillment: boolean;
  hasExpiredRequiredDocs: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (!isOnboardingComplete(input.checklist)) {
    return { ok: false, reason: 'onboarding_incomplete' };
  }
  if (!input.hasActiveFulfillment) {
    return { ok: false, reason: 'fulfillment_required' };
  }
  if (input.hasExpiredRequiredDocs) {
    return { ok: false, reason: 'documents_expired' };
  }
  return { ok: true };
}

export function canAcceptOrders(status: StoreStatus, canAcceptOrdersFlag: boolean): boolean {
  return status === 'active' && canAcceptOrdersFlag;
}

export function productsVisibleWhenSuspended(status: StoreStatus, productsVisible: boolean): boolean {
  if (status === 'suspended') return productsVisible;
  return productsVisible;
}

export class StoreService {
  constructor(private readonly db: PGlite) {}

  async createStore(input: { code: string; name: string }) {
    const store = await this.db.query<{ id: string }>(
      `INSERT INTO app.stores (code, name, status)
       VALUES ($1, $2, 'onboarding') RETURNING id`,
      [input.code, input.name],
    );
    const storeId = store.rows[0]!.id;
    await this.db.query(
      `INSERT INTO app.store_risk_profiles (store_id) VALUES ($1)`,
      [storeId],
    );
    await this.db.query(
      `INSERT INTO private.store_onboarding_checklists (store_id) VALUES ($1)`,
      [storeId],
    );
    return storeId;
  }

  async listStores(limit = 50): Promise<
    Array<{ id: string; code: string; name: string; status: StoreStatus }>
  > {
    const row = await this.db.query<{
      id: string;
      code: string;
      name: string;
      status: StoreStatus;
    }>(
      `SELECT id, code, name, status::text AS status
       FROM app.stores
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
    );
    return row.rows;
  }

  async addContact(input: {
    storeId: string;
    contactType: 'owner' | 'ops' | 'finance' | 'support';
    fullName: string;
    phoneE164: string;
    isPrimary?: boolean;
  }) {
    await this.db.query(
      `INSERT INTO app.store_contacts
        (store_id, contact_type, full_name, phone_e164, is_primary)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        input.storeId,
        input.contactType,
        input.fullName,
        input.phoneE164,
        input.isPrimary ?? false,
      ],
    );
  }

  async addFulfillmentLocation(input: {
    storeId: string;
    name: string;
    addressLine: string;
    active: boolean;
  }) {
    if (input.active) {
      const existing = await this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM app.fulfillment_locations
         WHERE store_id = $1 AND active = true AND archived_at IS NULL`,
        [input.storeId],
      );
      if ((existing.rows[0]?.n ?? 0) > 0) {
        throw new Error('phase1_one_active_fulfillment_location');
      }
    }
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO app.fulfillment_locations (store_id, name, address_line, active)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [input.storeId, input.name, input.addressLine, input.active],
    );
    return row.rows[0]!.id;
  }

  async uploadDocument(input: {
    storeId: string;
    docType: 'owner_id' | 'store_info' | 'bank_account' | 'contract';
    storageKey: string;
    expiresAt?: string;
  }) {
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO private.store_documents
        (store_id, doc_type, storage_key, status, expires_at)
       VALUES ($1,$2,$3,'uploaded',$4) RETURNING id`,
      [input.storeId, input.docType, input.storageKey, input.expiresAt ?? null],
    );
    return row.rows[0]!.id;
  }

  async verifyDocument(documentId: string, storeId: string) {
    const doc = await this.db.query<{ doc_type: string }>(
      `UPDATE private.store_documents
       SET status = 'verified', verified_at = timezone('utc', now())
       WHERE id = $1 AND store_id = $2
       RETURNING doc_type`,
      [documentId, storeId],
    );
    const type = doc.rows[0]?.doc_type;
    if (!type) throw new Error('document_not_found');
    const column =
      type === 'owner_id'
        ? 'owner_id_ok'
        : type === 'store_info'
          ? 'store_info_ok'
          : type === 'bank_account'
            ? 'bank_account_ok'
            : 'contract_ok';
    await this.db.query(
      `UPDATE private.store_onboarding_checklists
       SET ${column} = true, updated_at = timezone('utc', now())
       WHERE store_id = $1`,
      [storeId],
    );
  }

  async getChecklist(storeId: string): Promise<OnboardingChecklist> {
    const row = await this.db.query<{
      owner_id_ok: boolean;
      store_info_ok: boolean;
      bank_account_ok: boolean;
      contract_ok: boolean;
    }>(
      `SELECT owner_id_ok, store_info_ok, bank_account_ok, contract_ok
       FROM private.store_onboarding_checklists WHERE store_id = $1`,
      [storeId],
    );
    const c = row.rows[0]!;
    return {
      ownerIdOk: c.owner_id_ok,
      storeInfoOk: c.store_info_ok,
      bankAccountOk: c.bank_account_ok,
      contractOk: c.contract_ok,
    };
  }

  async issueSignedAccess(input: {
    storageKey: string;
    actorIdentityId: string;
    documentId: string;
    reason: string;
    ttlMs?: number;
    now?: number;
  }) {
    const now = input.now ?? Date.now();
    const expiresAt = new Date(now + (input.ttlMs ?? 5 * 60_000)).toISOString();
    const token = createHash('sha256').update(randomBytes(32)).digest('hex');
    await this.db.query(
      `INSERT INTO private.signed_access_tokens
        (storage_key, actor_identity_id, expires_at)
       VALUES ($1,$2,$3)`,
      [input.storageKey, input.actorIdentityId, expiresAt],
    );
    await this.db.query(
      `INSERT INTO private.store_document_access_logs
        (document_id, actor_identity_id, access_mode, reason, correlation_id)
       VALUES ($1,$2,'signed_url',$3,$4)`,
      [input.documentId, input.actorIdentityId, input.reason, crypto.randomUUID()],
    );
    return { token, expiresAt };
  }

  async activateIfReady(storeId: string, today = new Date().toISOString().slice(0, 10)) {
    const checklist = await this.getChecklist(storeId);
    const fulfillment = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.fulfillment_locations
       WHERE store_id = $1 AND active = true AND archived_at IS NULL`,
      [storeId],
    );
    const expired = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM private.store_documents
       WHERE store_id = $1 AND status = 'verified'
         AND expires_at IS NOT NULL AND expires_at < $2::date`,
      [storeId, today],
    );
    const decision = canActivateStore({
      checklist,
      hasActiveFulfillment: (fulfillment.rows[0]?.n ?? 0) === 1,
      hasExpiredRequiredDocs: (expired.rows[0]?.n ?? 0) > 0,
    });
    if (!decision.ok) return decision;

    await this.db.query(
      `UPDATE app.stores
       SET status = 'active', can_accept_orders = true, products_visible = true
       WHERE id = $1`,
      [storeId],
    );
    return decision;
  }

  async suspendForExpiredDocuments(storeId: string, actorIdentityId?: string) {
    await this.db.query(
      `UPDATE app.stores
       SET status = 'suspended', can_accept_orders = false,
           products_visible = true, existing_orders_under_review = true
       WHERE id = $1`,
      [storeId],
    );
    await this.db.query(
      `INSERT INTO private.store_suspensions
        (store_id, reason_code, reason_detail, suspended_by)
       VALUES ($1, 'document_expired', 'required document expired', $2)`,
      [storeId, actorIdentityId ?? null],
    );
  }

  async scheduleDocumentExpiryAlerts(documentId: string, expiresAt: string, daysBefore = 14) {
    const alertAt = new Date(`${expiresAt}T00:00:00.000Z`);
    alertAt.setUTCDate(alertAt.getUTCDate() - daysBefore);
    await this.db.query(
      `INSERT INTO private.document_expiry_alerts (document_id, alert_at)
       VALUES ($1, $2)`,
      [documentId, alertAt.toISOString()],
    );
  }
}
