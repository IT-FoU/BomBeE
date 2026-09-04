const DEFAULT_API = 'http://localhost:8787';

export function apiBaseUrl(): string {
  if (import.meta.env.VITE_PUBLIC_API_URL) {
    return String(import.meta.env.VITE_PUBLIC_API_URL).replace(/\/$/, '');
  }
  if (typeof window !== 'undefined' && window.location.port === '5174') {
    return '';
  }
  return DEFAULT_API;
}

export type IssuedInvite = {
  id: string;
  inviteCode: string;
  intendedRole: string;
  maxUses: number;
  useCount: number;
  note?: string | null;
};

export type IssuedStore = {
  id: string;
  code: string;
  name: string;
  status: string;
};

export async function createInvite(input: {
  inviteCode: string;
  intendedRole: string;
  maxUses: number;
  note?: string;
}): Promise<IssuedInvite> {
  const res = await fetch(`${apiBaseUrl()}/v1/invites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `invite_create_failed_${res.status}`);
  }
  const body = (await res.json()) as { invite: IssuedInvite };
  return body.invite;
}

export async function listInvites(): Promise<IssuedInvite[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/invites`);
  if (!res.ok) {
    throw new Error(`invite_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { invites: IssuedInvite[] };
  return body.invites;
}

export async function createStoreDraft(input: {
  name: string;
  code?: string;
}): Promise<IssuedStore> {
  const res = await fetch(`${apiBaseUrl()}/v1/stores`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `store_create_failed_${res.status}`);
  }
  const body = (await res.json()) as { store: IssuedStore };
  return body.store;
}

export async function listStores(): Promise<IssuedStore[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/stores`);
  if (!res.ok) {
    throw new Error(`store_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { stores: IssuedStore[] };
  return body.stores;
}

export type CodShipmentRow = {
  codShipmentId: string;
  childOrderId: string;
  parentOrderId: string;
  status: string;
  amountLak: number;
  depositLak: number;
  balanceDueLak: number;
  createdAt: string;
};

export async function listCodShipments(): Promise<CodShipmentRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/cod/shipments`);
  if (!res.ok) {
    throw new Error(`cod_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { shipments: CodShipmentRow[] };
  return body.shipments;
}

export async function mockRemitCodShipment(
  codShipmentId: string,
  input: { courierRef?: string; amountLak?: number } = {},
): Promise<{
  status: string;
  amountLak: number;
  reconcile: { expectedLak: number; actualLak: number; difference: number };
  idempotentReplay?: boolean;
}> {
  const res = await fetch(`${apiBaseUrl()}/v1/cod/shipments/${codShipmentId}/mock-remit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `cod_remit_failed_${res.status}`);
  }
  return (await res.json()) as {
    status: string;
    amountLak: number;
    reconcile: { expectedLak: number; actualLak: number; difference: number };
    idempotentReplay?: boolean;
  };
}

export type OpsOrderRow = {
  parentId: string;
  orderNumber: string;
  status: string;
  totalLak: number;
  createdAt: string;
  customerIdentityId: string;
  children: Array<{
    childOrderId: string;
    storeId: string;
    status: string;
    totalLak: number;
    paymentReceived: boolean;
  }>;
};

export async function listOrders(limit = 50): Promise<OpsOrderRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/orders?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`orders_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { orders: OpsOrderRow[] };
  return body.orders;
}

async function opsOrderAction(
  path: string,
): Promise<{ orders?: OpsOrderRow[]; children?: unknown[]; confirmedChildIds?: string[] }> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `ops_action_failed_${res.status}`);
  }
  return (await res.json()) as {
    orders?: OpsOrderRow[];
    children?: unknown[];
    confirmedChildIds?: string[];
  };
}

export async function opsConfirmChildren(parentId: string) {
  return opsOrderAction(`/v1/ops/orders/${parentId}/confirm-children`);
}

export async function opsMockAdvance(parentId: string) {
  return opsOrderAction(`/v1/ops/orders/${parentId}/fulfillment/mock-advance`);
}

export async function opsMockDeliver(parentId: string) {
  return opsOrderAction(`/v1/ops/orders/${parentId}/fulfillment/mock-deliver`);
}

export type OpsCatalogProduct = {
  id: string;
  titleEn: string;
  titleLo: string;
  storeName: string;
  priceLak: number;
  availableQty: number;
  variants: Array<{ id: string; sku: string; label: string; priceLak: number }>;
};

export async function listCatalogProducts(limit = 50): Promise<OpsCatalogProduct[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/catalog/products?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`catalog_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { products: OpsCatalogProduct[] };
  return body.products;
}

export type OpsStockView = {
  variantId: string;
  availableQty: number;
  balances: Array<{
    balanceId: string;
    storeId: string;
    onHand: number;
    reserved: number;
    available: number;
    lotId: string;
    lotCode: string | null;
    expiryDate: string | null;
  }>;
};

export async function fetchVariantStock(variantId: string): Promise<OpsStockView> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/inventory/stock?variantId=${encodeURIComponent(variantId)}`,
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `stock_failed_${res.status}`);
  }
  const body = (await res.json()) as OpsStockView & { ok?: boolean };
  return {
    variantId: body.variantId,
    availableQty: Number(body.availableQty),
    balances: (body.balances ?? []).map((b) => ({
      ...b,
      onHand: Number(b.onHand),
      reserved: Number(b.reserved),
      available: Number(b.available),
    })),
  };
}

export type SettlementBatchRow = {
  batchId: string;
  storeId: string;
  storeName: string;
  status: string;
  cadence: string;
  grossLak: number;
  netLak: number;
  heldLak: number;
  lineCount: number;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
};

export async function listSettlementBatches(limit = 50): Promise<SettlementBatchRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/settlements?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`settlements_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { batches: SettlementBatchRow[] };
  return body.batches;
}

export async function mockCreateSettlementBatch(storeId?: string): Promise<{
  batchId: string;
  grossLak: number;
  netLak: number;
  lineCount: number;
  batches: SettlementBatchRow[];
}> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/settlements/mock-create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(storeId ? { store_id: storeId } : {}),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `settlement_create_failed_${res.status}`);
  }
  return (await res.json()) as {
    batchId: string;
    grossLak: number;
    netLak: number;
    lineCount: number;
    batches: SettlementBatchRow[];
  };
}

export type SettlementLineRow = {
  lineId: string;
  childOrderId: string;
  amountLak: number;
  held: boolean;
  disputed: boolean;
  holdReason: string | null;
};

export async function listSettlementLines(batchId: string): Promise<SettlementLineRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/settlements/${batchId}/lines`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `settlement_lines_failed_${res.status}`);
  }
  const body = (await res.json()) as { lines: SettlementLineRow[] };
  return body.lines;
}

async function settlementOpsAction(
  path: string,
  body: Record<string, unknown> = {},
): Promise<{ batches?: SettlementBatchRow[]; status?: string; disputeId?: string }> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `settlement_ops_failed_${res.status}`);
  }
  return (await res.json()) as {
    batches?: SettlementBatchRow[];
    status?: string;
    disputeId?: string;
  };
}

export async function submitSettlementBatch(batchId: string) {
  return settlementOpsAction(`/v1/ops/settlements/${batchId}/submit`);
}

export async function approveSettlementBatch(batchId: string) {
  return settlementOpsAction(`/v1/ops/settlements/${batchId}/approve`);
}

export async function disputeSettlementBatch(
  batchId: string,
  input: { childOrderId?: string; reason?: string } = {},
) {
  return settlementOpsAction(`/v1/ops/settlements/${batchId}/dispute`, {
    child_order_id: input.childOrderId,
    reason: input.reason,
  });
}

export type SupportTicketRow = {
  ticketId: string;
  subject: string;
  status: string;
  urgency: string;
  channel: string;
  customerIdentityId: string;
  messageCount: number;
  firstResponseDueAt: string;
  resolutionDueAt: string;
  createdAt: string;
};

export async function listSupportTickets(limit = 50): Promise<SupportTicketRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/support/tickets?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`support_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { tickets: SupportTicketRow[] };
  return body.tickets;
}

export async function mockCreateSupportTicket(input: {
  subject?: string;
  body?: string;
  urgency?: 'general' | 'urgent';
} = {}): Promise<{ ticketId: string; tickets: SupportTicketRow[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/support/tickets/mock-create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `support_create_failed_${res.status}`);
  }
  return (await res.json()) as { ticketId: string; tickets: SupportTicketRow[] };
}

export async function replySupportTicket(
  ticketId: string,
  body: string,
): Promise<{ tickets?: SupportTicketRow[]; status?: string }> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/support/tickets/${ticketId}/reply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `support_reply_failed_${res.status}`);
  }
  return (await res.json()) as { tickets?: SupportTicketRow[]; status?: string };
}

export async function resolveSupportTicket(
  ticketId: string,
): Promise<{ tickets?: SupportTicketRow[]; status?: string }> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/support/tickets/${ticketId}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `support_resolve_failed_${res.status}`);
  }
  return (await res.json()) as { tickets?: SupportTicketRow[]; status?: string };
}

export type ReturnRequestRow = {
  returnRequestId: string;
  childOrderId: string;
  parentOrderId: string;
  reason: string;
  status: string;
  shippingLiability: string | null;
  amountLak: number;
  requestedAt: string;
  deliveredAt: string;
};

export async function listReturns(limit = 50): Promise<ReturnRequestRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/returns?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`returns_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { returns: ReturnRequestRow[] };
  return body.returns;
}

export async function mockCreateReturn(input: {
  childOrderId?: string;
  reason?: string;
} = {}): Promise<{ returnRequestId: string; returns: ReturnRequestRow[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/returns/mock-create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      child_order_id: input.childOrderId,
      reason: input.reason,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `return_create_failed_${res.status}`);
  }
  return (await res.json()) as { returnRequestId: string; returns: ReturnRequestRow[] };
}

export async function approveReturn(
  returnRequestId: string,
): Promise<{ returns?: ReturnRequestRow[]; status?: string }> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/returns/${returnRequestId}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `return_approve_failed_${res.status}`);
  }
  return (await res.json()) as { returns?: ReturnRequestRow[]; status?: string };
}

export type PromotionRow = {
  promotionId: string;
  code: string;
  titleEn: string;
  titleLo: string;
  status: string;
  funding: string;
  percentOff: number | null;
  amountOffLak: number | null;
  budgetLak: number;
  spentLak: number;
  redeemedCount: number;
  effectiveFrom: string;
  effectiveTo: string;
};

export async function listPromotions(limit = 50): Promise<PromotionRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/promotions?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`promotions_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { promotions: PromotionRow[] };
  return body.promotions;
}

export async function mockCreatePromotion(input: {
  code?: string;
  titleEn?: string;
  percentOff?: number;
} = {}): Promise<{ promotionId: string; promotions: PromotionRow[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/promotions/mock-create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: input.code,
      title_en: input.titleEn,
      percent_off: input.percentOff,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `promotion_create_failed_${res.status}`);
  }
  return (await res.json()) as { promotionId: string; promotions: PromotionRow[] };
}

export async function pausePromotion(
  promotionId: string,
): Promise<{ promotions?: PromotionRow[]; status?: string }> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/promotions/${promotionId}/pause`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `promotion_pause_failed_${res.status}`);
  }
  return (await res.json()) as { promotions?: PromotionRow[]; status?: string };
}

export type RefundApprovalRow = {
  approvalId: string;
  refundRequestId: string;
  childOrderId: string;
  parentOrderId: string;
  amountLak: number;
  reason: string;
  status: string;
  slaDueAt: string | null;
};

export async function listRefunds(limit = 50): Promise<RefundApprovalRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/refunds?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`refunds_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { refunds: RefundApprovalRow[] };
  return body.refunds;
}

export async function mockCreateRefund(input: {
  childOrderId?: string;
  amountLak?: number;
  reason?: string;
} = {}): Promise<{ approvalId: string; refunds: RefundApprovalRow[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/refunds/mock-create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      child_order_id: input.childOrderId,
      amount_lak: input.amountLak,
      reason: input.reason,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `refund_create_failed_${res.status}`);
  }
  return (await res.json()) as { approvalId: string; refunds: RefundApprovalRow[] };
}

export async function approveRefund(
  approvalId: string,
): Promise<{ refunds?: RefundApprovalRow[]; status?: string; slaDueAt?: string }> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/refunds/${approvalId}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `refund_approve_failed_${res.status}`);
  }
  return (await res.json()) as {
    refunds?: RefundApprovalRow[];
    status?: string;
    slaDueAt?: string;
  };
}

export async function mockPayRefund(
  approvalId: string,
): Promise<{ refunds?: RefundApprovalRow[]; status?: string; withinSla?: boolean }> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/refunds/${approvalId}/mock-pay`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `refund_pay_failed_${res.status}`);
  }
  return (await res.json()) as {
    refunds?: RefundApprovalRow[];
    status?: string;
    withinSla?: boolean;
  };
}

export type AuditEventRow = {
  eventId: string;
  actorIdentityId: string | null;
  actorType: string;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  correlationId: string;
  createdAt: string;
};

export async function listAuditEvents(limit = 50): Promise<AuditEventRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/audit/events?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`audit_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { events: AuditEventRow[] };
  return body.events;
}

export async function mockAuditEvent(input: {
  action?: string;
  reason?: string;
} = {}): Promise<{ eventId: string; events: AuditEventRow[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/audit/mock-event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `audit_mock_failed_${res.status}`);
  }
  return (await res.json()) as { eventId: string; events: AuditEventRow[] };
}

export type ExportRequestRow = {
  exportId: string;
  exportType: string;
  reason: string;
  status: string;
  downloadCount: number;
  downloadLimit: number;
  requesterIdentityId: string;
  createdAt: string;
  expiresAt: string | null;
};

export async function listExports(limit = 50): Promise<ExportRequestRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/exports?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`exports_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { exports: ExportRequestRow[] };
  return body.exports;
}

export async function mockCreateExport(input: {
  exportType?: string;
  reason?: string;
} = {}): Promise<{ exportId: string; exports: ExportRequestRow[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/exports/mock-create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      export_type: input.exportType,
      reason: input.reason,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `export_create_failed_${res.status}`);
  }
  return (await res.json()) as { exportId: string; exports: ExportRequestRow[] };
}

export async function approveExportRequest(
  exportId: string,
): Promise<{ exports?: ExportRequestRow[]; status?: string }> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/exports/${exportId}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `export_approve_failed_${res.status}`);
  }
  return (await res.json()) as { exports?: ExportRequestRow[]; status?: string };
}

export async function mockDownloadExport(
  exportId: string,
): Promise<{ exports?: ExportRequestRow[]; status?: string; downloadCount?: number }> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/exports/${exportId}/mock-download`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `export_download_failed_${res.status}`);
  }
  return (await res.json()) as {
    exports?: ExportRequestRow[];
    status?: string;
    downloadCount?: number;
  };
}

export type NotificationInboxRow = {
  inboxId: string;
  recipientIdentityId: string;
  channel: string;
  template: string;
  title: string;
  body: string;
  actionLink: string | null;
  read: boolean;
  createdAt: string;
};

export type NotificationOutboxRow = {
  outboxId: string;
  channel: string;
  provider: string;
  destination: string;
  template: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
};

export async function listNotifications(
  limit = 50,
): Promise<{ inbox: NotificationInboxRow[]; outbox: NotificationOutboxRow[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/notifications?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`notifications_list_failed_${res.status}`);
  }
  return (await res.json()) as {
    inbox: NotificationInboxRow[];
    outbox: NotificationOutboxRow[];
  };
}

export async function mockEnqueueNotification(input: {
  title?: string;
  body?: string;
  template?: string;
} = {}): Promise<{
  outboxId: string;
  inbox: NotificationInboxRow[];
  outbox: NotificationOutboxRow[];
}> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/notifications/mock-enqueue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `notification_enqueue_failed_${res.status}`);
  }
  return (await res.json()) as {
    outboxId: string;
    inbox: NotificationInboxRow[];
    outbox: NotificationOutboxRow[];
  };
}

export async function mockProcessNotifications(): Promise<{
  inbox: NotificationInboxRow[];
  outbox: NotificationOutboxRow[];
}> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/notifications/mock-process`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `notification_process_failed_${res.status}`);
  }
  return (await res.json()) as {
    inbox: NotificationInboxRow[];
    outbox: NotificationOutboxRow[];
  };
}

export async function markNotificationRead(
  inboxId: string,
): Promise<{ inbox: NotificationInboxRow[]; outbox: NotificationOutboxRow[] }> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/notifications/inbox/${encodeURIComponent(inboxId)}/mark-read`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `notification_mark_read_failed_${res.status}`);
  }
  return (await res.json()) as {
    inbox: NotificationInboxRow[];
    outbox: NotificationOutboxRow[];
  };
}

export type IntegrationChecklistItem = {
  id: string;
  label: string;
  ok: boolean;
};

export type IntegrationStoreRow = {
  storeId: string;
  storeCode: string;
  storeName: string;
  canAcceptOrders: boolean;
  egoDisplay: string;
  egoStatus: string;
  featureFlagOn: boolean;
  credentialsConfigured: boolean;
};

export type IntegrationsStatus = {
  env: string;
  integrationsMode: string;
  egoPosEnabled: boolean;
  inviteOnlyEnabled: boolean;
  productionHold: boolean;
  smsProvider: string;
  canSendEgoTraffic: boolean;
  checklist: IntegrationChecklistItem[];
  stores: IntegrationStoreRow[];
};

export async function listIntegrations(): Promise<IntegrationsStatus> {
  const res = await fetch(`${apiBaseUrl()}/v1/integrations`);
  if (!res.ok) {
    throw new Error(`integrations_list_failed_${res.status}`);
  }
  return (await res.json()) as IntegrationsStatus;
}

export async function mockEnsureEgoProfiles(): Promise<{
  profiles: Array<{ storeId: string; profileId: string; status: string }>;
  stores: IntegrationStoreRow[];
}> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/integrations/ego/mock-ensure`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `ego_ensure_failed_${res.status}`);
  }
  return (await res.json()) as {
    profiles: Array<{ storeId: string; profileId: string; status: string }>;
    stores: IntegrationStoreRow[];
  };
}

export type StaffRoleCatalogRow = {
  role: string;
  permissions: string[];
};

export type StaffDirectoryRow = {
  staffProfileId: string;
  identityId: string;
  subject: string;
  displayName: string;
  phoneE164: string | null;
  status: string;
  roles: string[];
};

export async function listStaffDirectory(
  limit = 50,
): Promise<{ roles: StaffRoleCatalogRow[]; staff: StaffDirectoryRow[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/staff?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`staff_list_failed_${res.status}`);
  }
  return (await res.json()) as {
    roles: StaffRoleCatalogRow[];
    staff: StaffDirectoryRow[];
  };
}

export type DashboardKpis = {
  source: string;
  orders: number;
  salesLak: number;
  paymentReceiptsLak: number;
  refundsLak: number;
  settlementsNetLak: number;
  stockOnHand: number;
  supportOpen: number;
  supportBreached: number;
  storesSuspended: number;
};

export type PaymentsReconcile = {
  totalRequests: number;
  mismatchCount: number;
  ok: boolean;
};

export async function fetchDashboardKpis(storeId?: string): Promise<DashboardKpis> {
  const qs = storeId ? `?store_id=${encodeURIComponent(storeId)}` : '';
  const res = await fetch(`${apiBaseUrl()}/v1/reports/dashboard${qs}`);
  if (!res.ok) {
    throw new Error(`dashboard_kpis_failed_${res.status}`);
  }
  const body = (await res.json()) as { kpis: DashboardKpis };
  return body.kpis;
}

export async function fetchPaymentsReconcile(): Promise<PaymentsReconcile> {
  const res = await fetch(`${apiBaseUrl()}/v1/reports/payments/reconcile`);
  if (!res.ok) {
    throw new Error(`payments_reconcile_failed_${res.status}`);
  }
  const body = (await res.json()) as { reconcile: PaymentsReconcile };
  return body.reconcile;
}

export type BackupJobRow = {
  jobId: string;
  jobType: string;
  status: string;
  checksumSha256: string | null;
  storageUri: string | null;
  offlineCopyUri: string | null;
  rpoSeconds: number | null;
  rtoSeconds: number | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type BackupAlertRow = {
  alertId: string;
  jobId: string;
  message: string;
  createdAt: string;
};

export async function listBackups(
  limit = 50,
): Promise<{ jobs: BackupJobRow[]; alerts: BackupAlertRow[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/backups?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`backups_list_failed_${res.status}`);
  }
  return (await res.json()) as { jobs: BackupJobRow[]; alerts: BackupAlertRow[] };
}

export async function mockRunBackup(input: {
  jobType?: string;
  fail?: boolean;
} = {}): Promise<{
  jobId: string;
  status: string;
  jobs: BackupJobRow[];
  alerts: BackupAlertRow[];
}> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/backups/mock-run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      job_type: input.jobType ?? 'daily_critical',
      fail: input.fail === true,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `backup_run_failed_${res.status}`);
  }
  return (await res.json()) as {
    jobId: string;
    status: string;
    jobs: BackupJobRow[];
    alerts: BackupAlertRow[];
  };
}

export async function verifyBackup(
  jobId: string,
): Promise<{ jobs?: BackupJobRow[]; checksum?: string }> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/backups/${encodeURIComponent(jobId)}/verify`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `backup_verify_failed_${res.status}`);
  }
  return (await res.json()) as { jobs?: BackupJobRow[]; checksum?: string };
}

export async function restoreDrillBackup(
  jobId: string,
): Promise<{ jobs?: BackupJobRow[]; ok?: boolean }> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/backups/${encodeURIComponent(jobId)}/restore-drill`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `backup_drill_failed_${res.status}`);
  }
  return (await res.json()) as { jobs?: BackupJobRow[]; ok?: boolean };
}

export type DeletionRequestRow = {
  requestId: string;
  customerIdentityId: string;
  status: string;
  otpVerified: boolean;
  approvedBy: string | null;
  createdAt: string;
  completedAt: string | null;
};

export async function listDeletionRequests(limit = 50): Promise<DeletionRequestRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/privacy/deletion-requests?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`deletion_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { requests: DeletionRequestRow[] };
  return body.requests;
}

export async function approveDeletionRequest(
  requestId: string,
): Promise<{ requests?: DeletionRequestRow[]; status?: string }> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/privacy/deletion-requests/${encodeURIComponent(requestId)}/approve`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `deletion_approve_failed_${res.status}`);
  }
  return (await res.json()) as { requests?: DeletionRequestRow[]; status?: string };
}

export type ReviewRow = {
  reviewId: string;
  productId: string;
  childOrderId: string;
  rating: number;
  bodyLo: string | null;
  bodyEn: string | null;
  verifiedPurchase: boolean;
  status: string;
  createdAt: string;
};

export type TikTokLinkRow = {
  linkId: string;
  url: string;
  productId: string | null;
  submittedByType: string;
  status: string;
  createdAt: string;
  publishedAt: string | null;
};

export async function listReviews(limit = 50): Promise<ReviewRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/reviews?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`reviews_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { reviews: ReviewRow[] };
  return body.reviews;
}

export async function mockCreateReview(input: {
  rating?: number;
  bodyEn?: string;
} = {}): Promise<{ reviewId: string; reviews: ReviewRow[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/reviews/mock-create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      rating: input.rating,
      body_en: input.bodyEn,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `review_mock_create_failed_${res.status}`);
  }
  return (await res.json()) as { reviewId: string; reviews: ReviewRow[] };
}

export async function listTikTokLinks(limit = 50): Promise<TikTokLinkRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/tiktok-links?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`tiktok_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { links: TikTokLinkRow[] };
  return body.links;
}

export async function mockSubmitTikTokLink(input: {
  url?: string;
  as?: 'staff' | 'supplier' | 'customer';
} = {}): Promise<{ linkId: string; status: string; links: TikTokLinkRow[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/tiktok-links/mock-submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `tiktok_mock_submit_failed_${res.status}`);
  }
  return (await res.json()) as { linkId: string; status: string; links: TikTokLinkRow[] };
}

export async function moderateTikTokLink(
  linkId: string,
  approve: boolean,
): Promise<{ links?: TikTokLinkRow[]; status?: string }> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/tiktok-links/${encodeURIComponent(linkId)}/moderate`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approve }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `tiktok_moderate_failed_${res.status}`);
  }
  return (await res.json()) as { links?: TikTokLinkRow[]; status?: string };
}

export type RecallRow = {
  recallId: string;
  productId: string;
  lotId: string | null;
  reason: string;
  status: string;
  storeBearsCost: boolean;
  createdBy: string | null;
  createdAt: string;
  completedAt: string | null;
  affectedCount: number;
  pendingCount: number;
};

export type RecallAffectedRow = {
  childOrderId: string;
  customerIdentityId: string;
  contactStatus: string;
  resolution: string;
};

export async function listRecalls(limit = 50): Promise<RecallRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/recalls?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`recalls_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { recalls: RecallRow[] };
  return body.recalls;
}

export async function mockStartRecall(input: {
  productId?: string;
  reason?: string;
} = {}): Promise<{
  recallId: string;
  affectedCount: number;
  recalls: RecallRow[];
  affected: RecallAffectedRow[];
}> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/recalls/mock-start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      productId: input.productId,
      reason: input.reason,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `recall_start_failed_${res.status}`);
  }
  return (await res.json()) as {
    recallId: string;
    affectedCount: number;
    recalls: RecallRow[];
    affected: RecallAffectedRow[];
  };
}

export async function contactRecallAffected(
  recallId: string,
  input: {
    childOrderId?: string;
    contactStatus?: 'contacted' | 'unreachable';
    resolution?: 'refund' | 'replacement' | 'declined' | 'pending';
  } = {},
): Promise<{
  recalls?: RecallRow[];
  affected?: RecallAffectedRow[];
  complete?: boolean;
}> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/recalls/${encodeURIComponent(recallId)}/contact`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        childOrderId: input.childOrderId,
        contactStatus: input.contactStatus ?? 'contacted',
        resolution: input.resolution ?? 'refund',
      }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `recall_contact_failed_${res.status}`);
  }
  return (await res.json()) as {
    recalls?: RecallRow[];
    affected?: RecallAffectedRow[];
    complete?: boolean;
  };
}

export type QualityEventRow = {
  eventId: string;
  storeId: string;
  eventType: string;
  occurredAt: string;
};

export type SuspensionRow = {
  suspensionId: string;
  storeId: string;
  reasonCode: string;
  reasonDetail: string | null;
  active: boolean;
  suspendedAt: string;
  reactivatedAt: string | null;
};

export async function listStoreQuality(limit = 50): Promise<{
  events: QualityEventRow[];
  suspensions: SuspensionRow[];
}> {
  const res = await fetch(`${apiBaseUrl()}/v1/stores/quality?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`quality_list_failed_${res.status}`);
  }
  return (await res.json()) as { events: QualityEventRow[]; suspensions: SuspensionRow[] };
}

export async function mockQualityEvent(input: {
  storeId?: string;
  eventType?: string;
  count?: number;
} = {}): Promise<{
  storeId: string;
  result?: { suspended?: boolean; reason?: string };
  events: QualityEventRow[];
  suspensions: SuspensionRow[];
}> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/stores/quality/mock-event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `quality_event_failed_${res.status}`);
  }
  return (await res.json()) as {
    storeId: string;
    result?: { suspended?: boolean; reason?: string };
    events: QualityEventRow[];
    suspensions: SuspensionRow[];
  };
}

export async function reactivateStore(
  storeId: string,
  evidence?: string,
): Promise<{ events?: QualityEventRow[]; suspensions?: SuspensionRow[]; status?: string }> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/stores/${encodeURIComponent(storeId)}/reactivate`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ evidence }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `store_reactivate_failed_${res.status}`);
  }
  return (await res.json()) as {
    events?: QualityEventRow[];
    suspensions?: SuspensionRow[];
    status?: string;
  };
}
