export type AuditEventInput = {
  actorIdentityId?: string;
  actorType: 'customer' | 'staff' | 'system';
  action: string;
  targetType: string;
  targetId?: string;
  beforeState?: unknown;
  afterState?: unknown;
  reason?: string;
  ip?: string;
  deviceId?: string;
  correlationId: string;
  createdAt?: Date;
};

export type AuditEvent = AuditEventInput & {
  id: string;
  createdAt: Date;
  retainUntil: Date;
};

export function retainUntilFrom(createdAt: Date, years = 5): Date {
  const d = new Date(createdAt);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

export function createAuditEvent(id: string, input: AuditEventInput): AuditEvent {
  const createdAt = input.createdAt ?? new Date();
  return {
    ...input,
    id,
    createdAt,
    retainUntil: retainUntilFrom(createdAt),
  };
}
