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
