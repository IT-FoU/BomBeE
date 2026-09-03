import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';

import { createTestDatabase } from '../../db/migrate.js';
import { MockSmsProvider } from '../identity/otp.js';
import { IdentityService } from '../identity/service.js';
import { ExportService } from './service.js';
import { decryptExportPayload, encryptExportPayload } from './exports.js';
import { randomBytes } from 'node:crypto';

describe('ExportService', () => {
  let db: PGlite;
  let exports: ExportService;
  let requesterId: string;
  let approverId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    const identity = new IdentityService(db, new MockSmsProvider());
    const requester = await identity.ensureStaff('staff:fin1', 'Finance', '+8562082220001');
    const approver = await identity.ensureStaff('staff:owner-export', 'Owner', '+8562082220002');
    requesterId = requester.identityId;
    approverId = approver.identityId;
    exports = new ExportService(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it('requires reason, encrypts artifact, enforces approval and expiry', async () => {
    expect(() =>
      encryptExportPayload(Buffer.from('x'), randomBytes(16)),
    ).toThrow(/32 bytes/);

    const key = randomBytes(32);
    const enc = encryptExportPayload(Buffer.from('secret-rows'), key);
    expect(decryptExportPayload(enc, key).toString('utf8')).toBe('secret-rows');

    await expect(
      exports.requestExport({
        requesterIdentityId: requesterId,
        exportType: 'customers',
        reason: 'short',
        payload: Buffer.from('[]'),
      }),
    ).rejects.toThrow(/reason/);

    const exportId = await exports.requestExport({
      requesterIdentityId: requesterId,
      exportType: 'customers',
      reason: 'monthly compliance extract',
      payload: Buffer.from('[{"id":"demo"}]'),
    });

    await expect(
      exports.approve({ exportId, actorIdentityId: requesterId }),
    ).rejects.toThrow(/self approval/);

    const approved = await exports.approve({
      exportId,
      actorIdentityId: approverId,
      now: 1_000,
    });
    expect(approved.status).toBe('approved');

    const downloaded = await exports.download({
      exportId,
      actorIdentityId: requesterId,
      now: 2_000,
    });
    expect(downloaded.ok).toBe(true);

    const expired = await exports.download({
      exportId,
      actorIdentityId: requesterId,
      now: 1_000 + 25 * 60 * 60_000,
    });
    expect(expired).toEqual({ ok: false, reason: 'expired' });
  });
});
