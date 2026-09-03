import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type ExportRequest = {
  id: string;
  requesterIdentityId: string;
  exportType: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'ready' | 'expired' | 'deleted';
  approverIdentityId?: string;
  downloadLimit: number;
  downloadCount: number;
  expiresAt?: number;
  artifact?: { ciphertext: Buffer; nonce: Buffer };
};

export type ExportAccessEventType =
  | 'created'
  | 'approved'
  | 'rejected'
  | 'downloaded'
  | 'expired'
  | 'deleted';

const ENC_ALGO = 'aes-256-gcm';

export function assertExportReason(reason: string): void {
  if (reason.trim().length < 8) {
    throw new Error('export reason required (min 8 characters)');
  }
}

export function encryptExportPayload(plaintext: Buffer, key: Buffer): { ciphertext: Buffer; nonce: Buffer } {
  if (key.length !== 32) throw new Error('export key must be 32 bytes');
  const nonce = randomBytes(12);
  const cipher = createCipheriv(ENC_ALGO, key, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext: encrypted, nonce };
}

export function decryptExportPayload(
  artifact: { ciphertext: Buffer; nonce: Buffer },
  key: Buffer,
): Buffer {
  const authTag = artifact.ciphertext.subarray(artifact.ciphertext.length - 16);
  const data = artifact.ciphertext.subarray(0, artifact.ciphertext.length - 16);
  const decipher = createDecipheriv(ENC_ALGO, key, artifact.nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

export function approveExport(
  request: ExportRequest,
  actorIdentityId: string,
  now: number,
  ttlMs = 24 * 60 * 60_000,
): ExportRequest {
  if (request.status !== 'pending') throw new Error('export not pending');
  if (request.requesterIdentityId === actorIdentityId) {
    throw new Error('self approval forbidden');
  }
  return {
    ...request,
    status: 'approved',
    approverIdentityId: actorIdentityId,
    expiresAt: now + ttlMs,
  };
}

export function downloadExport(
  request: ExportRequest,
  now: number,
): { ok: true; next: ExportRequest } | { ok: false; reason: 'expired' | 'limit' | 'not_ready' } {
  if (request.status === 'expired' || (request.expiresAt !== undefined && now > request.expiresAt)) {
    return { ok: false, reason: 'expired' };
  }
  if (request.status !== 'approved' && request.status !== 'ready') {
    return { ok: false, reason: 'not_ready' };
  }
  if (request.downloadCount >= request.downloadLimit) {
    return { ok: false, reason: 'limit' };
  }
  return {
    ok: true,
    next: {
      ...request,
      status: 'ready',
      downloadCount: request.downloadCount + 1,
    },
  };
}
