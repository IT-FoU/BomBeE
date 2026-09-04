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

export type StoreDocumentRow = {
  documentId: string;
  storeId: string;
  docType: string;
  storageKey: string;
  status: string;
  expiresAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
};

export type StoreOnboarding = {
  storeId: string;
  status: string;
  checklist: {
    ownerIdOk: boolean;
    storeInfoOk: boolean;
    bankAccountOk: boolean;
    contractOk: boolean;
  };
  documents: StoreDocumentRow[];
  activeFulfillmentCount: number;
  activation: { ok: true } | { ok: false; reason: string };
};

export async function listStoreDocuments(
  limit = 50,
  storeId?: string,
): Promise<StoreDocumentRow[]> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (storeId) qs.set('storeId', storeId);
  const res = await fetch(`${apiBaseUrl()}/v1/stores/documents?${qs}`);
  if (!res.ok) {
    throw new Error(`store_documents_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { documents: StoreDocumentRow[] };
  return body.documents;
}

export async function fetchStoreOnboarding(storeId: string): Promise<StoreOnboarding> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/stores/${encodeURIComponent(storeId)}/onboarding`,
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `store_onboarding_failed_${res.status}`);
  }
  return (await res.json()) as StoreOnboarding;
}

export async function mockUploadStoreDocument(
  storeId: string,
  input: {
    docType?: 'owner_id' | 'store_info' | 'bank_account' | 'contract';
    expiresAt?: string;
  } = {},
): Promise<{
  documentId: string;
  documents: StoreDocumentRow[];
  onboarding?: StoreOnboarding;
}> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/stores/${encodeURIComponent(storeId)}/documents/mock-upload`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `store_doc_upload_failed_${res.status}`);
  }
  return (await res.json()) as {
    documentId: string;
    documents: StoreDocumentRow[];
    onboarding?: StoreOnboarding;
  };
}

export async function verifyStoreDocument(
  documentId: string,
  storeId?: string,
): Promise<{
  documents?: StoreDocumentRow[];
  onboarding?: StoreOnboarding;
  status?: string;
}> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/stores/documents/${encodeURIComponent(documentId)}/verify`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(storeId ? { storeId } : {}),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `store_doc_verify_failed_${res.status}`);
  }
  return (await res.json()) as {
    documents?: StoreDocumentRow[];
    onboarding?: StoreOnboarding;
    status?: string;
  };
}

export async function issueStoreDocumentSignedAccess(
  documentId: string,
  reason?: string,
): Promise<{ token: string; expiresAt: string }> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/stores/documents/${encodeURIComponent(documentId)}/signed-access`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: reason ?? 'BO mock document review' }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `store_doc_signed_failed_${res.status}`);
  }
  return (await res.json()) as { token: string; expiresAt: string };
}

export async function mockEnsureStoreFulfillment(
  storeId: string,
): Promise<{ locationId?: string; onboarding?: StoreOnboarding }> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/stores/${encodeURIComponent(storeId)}/fulfillment/mock-ensure`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `store_fulfillment_failed_${res.status}`);
  }
  return (await res.json()) as { locationId?: string; onboarding?: StoreOnboarding };
}

export async function activateStore(
  storeId: string,
): Promise<{
  ok: boolean;
  status?: string;
  error?: string;
  stores?: IssuedStore[];
  onboarding?: StoreOnboarding;
}> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/stores/${encodeURIComponent(storeId)}/activate`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    },
  );
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    status?: string;
    error?: string;
    stores?: IssuedStore[];
    onboarding?: StoreOnboarding;
  };
  if (!res.ok && res.status !== 409) {
    throw new Error(body.error ?? `store_activate_failed_${res.status}`);
  }
  return {
    ok: Boolean(body.ok),
    status: body.status,
    error: body.error,
    stores: body.stores,
    onboarding: body.onboarding,
  };
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

export type SplitShipmentRequestRow = {
  requestId: string;
  childOrderId: string;
  parentOrderId: string;
  orderNumber: string;
  shipmentId: string | null;
  status: string;
  reason: string;
  makerIdentityId: string;
  approverIdentityId: string | null;
  itemCount: number;
  createdAt: string;
  decidedAt: string | null;
};

export async function listSplitShipments(
  limit = 50,
): Promise<SplitShipmentRequestRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/orders/split-shipments?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`split_shipments_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { requests: SplitShipmentRequestRow[] };
  return body.requests;
}

export async function mockRequestSplitShipment(
  input: { childOrderId?: string; reason?: string } = {},
): Promise<{
  requestId: string;
  shipmentId: string;
  requests?: SplitShipmentRequestRow[];
}> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/orders/split-shipments/mock-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `split_request_failed_${res.status}`);
  }
  return (await res.json()) as {
    requestId: string;
    shipmentId: string;
    requests?: SplitShipmentRequestRow[];
  };
}

export async function approveSplitShipment(
  requestId: string,
  shipmentId?: string,
): Promise<{ requests?: SplitShipmentRequestRow[]; status?: string }> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/orders/split-shipments/${encodeURIComponent(requestId)}/approve`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(shipmentId ? { shipmentId } : {}),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `split_approve_failed_${res.status}`);
  }
  return (await res.json()) as { requests?: SplitShipmentRequestRow[]; status?: string };
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

export type CatalogImportBatchRow = {
  batchId: string;
  storeId: string;
  idempotencyKey: string;
  status: string;
  previewReport: { valid?: number; invalid?: number } | null;
  createdBy: string | null;
  createdAt: string;
};

export async function listCatalogImportBatches(
  limit = 50,
): Promise<CatalogImportBatchRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/catalog/import/batches?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`catalog_import_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { batches: CatalogImportBatchRow[] };
  return body.batches;
}

export async function previewCatalogImport(input: {
  idempotencyKey?: string;
  rows?: Array<{
    storeProductId: string;
    sku: string;
    titleLo: string;
    titleEn: string;
    categorySlug: string;
    costLak: number;
    sellingPriceLak: number;
  }>;
} = {}): Promise<{
  batchId: string;
  report: { valid: number; invalid: number };
  batches: CatalogImportBatchRow[];
}> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/catalog/import/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `catalog_import_preview_failed_${res.status}`);
  }
  return (await res.json()) as {
    batchId: string;
    report: { valid: number; invalid: number };
    batches: CatalogImportBatchRow[];
  };
}

export async function commitCatalogImport(
  batchId: string,
): Promise<{ batches?: CatalogImportBatchRow[]; status?: string }> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/catalog/import/${encodeURIComponent(batchId)}/commit`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `catalog_import_commit_failed_${res.status}`);
  }
  return (await res.json()) as { batches?: CatalogImportBatchRow[]; status?: string };
}

export type CatalogMediaRow = {
  mediaId: string;
  productId: string | null;
  variantId: string | null;
  mediaType: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  durationSeconds: number | null;
  widthPx: number | null;
  heightPx: number | null;
  thumbnailKey: string | null;
  validationStatus: string;
  createdAt: string;
};

export async function listCatalogMedia(
  limit = 50,
  filters: { productId?: string; variantId?: string } = {},
): Promise<CatalogMediaRow[]> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (filters.productId) qs.set('productId', filters.productId);
  if (filters.variantId) qs.set('variantId', filters.variantId);
  const res = await fetch(`${apiBaseUrl()}/v1/catalog/media?${qs}`);
  if (!res.ok) {
    throw new Error(`catalog_media_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { media: CatalogMediaRow[] };
  return body.media;
}

export async function mockUploadCatalogMedia(input: {
  productId?: string;
  variantId?: string;
  mediaType?: 'image' | 'video';
} = {}): Promise<{ mediaId: string; media: CatalogMediaRow[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/catalog/media/mock-upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `catalog_media_upload_failed_${res.status}`);
  }
  return (await res.json()) as { mediaId: string; media: CatalogMediaRow[] };
}

export async function issueCatalogMediaSignedUrl(
  mediaId: string,
): Promise<{ token: string; expiresAt: string }> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/catalog/media/${encodeURIComponent(mediaId)}/signed-url`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `catalog_media_signed_failed_${res.status}`);
  }
  return (await res.json()) as { token: string; expiresAt: string };
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

export type InventoryAdjustmentRow = {
  adjustmentId: string;
  balanceId: string;
  delta: number;
  reason: string;
  status: string;
  makerIdentityId: string;
  approverIdentityId: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export async function listInventoryAdjustments(
  limit = 50,
): Promise<InventoryAdjustmentRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/inventory/adjustments?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`inventory_adjustments_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { adjustments: InventoryAdjustmentRow[] };
  return body.adjustments;
}

export async function opsReceiveStock(input: {
  balanceId?: string;
  quantity?: number;
  reason?: string;
} = {}): Promise<{
  stock?: OpsStockView;
  adjustments?: InventoryAdjustmentRow[];
  onHand?: number;
}> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/inventory/receive`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `inventory_receive_failed_${res.status}`);
  }
  return (await res.json()) as {
    stock?: OpsStockView;
    adjustments?: InventoryAdjustmentRow[];
    onHand?: number;
  };
}

export async function opsAdjustStock(input: {
  balanceId?: string;
  delta?: number;
  reason?: string;
} = {}): Promise<{
  stock?: OpsStockView;
  adjustments?: InventoryAdjustmentRow[];
  onHand?: number;
  status?: string;
}> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/inventory/adjust`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `inventory_adjust_failed_${res.status}`);
  }
  return (await res.json()) as {
    stock?: OpsStockView;
    adjustments?: InventoryAdjustmentRow[];
    onHand?: number;
    status?: string;
  };
}

export type StockImportBatchRow = {
  batchId: string;
  storeId: string;
  idempotencyKey: string;
  status: string;
  previewReport: {
    rows?: Array<{
      variantId: string;
      lotId: string;
      current: number;
      imported: number;
      delta: number;
    }>;
    differenceTotal?: number;
  } | null;
  createdAt: string;
};

export async function listStockImportBatches(
  limit = 50,
): Promise<StockImportBatchRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/inventory/import/batches?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`stock_import_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { batches: StockImportBatchRow[] };
  return body.batches;
}

export async function previewStockImport(input: {
  storeId?: string;
  idempotencyKey?: string;
  rows?: Array<{ variantId: string; lotId: string; onHand: number }>;
} = {}): Promise<{
  batchId: string;
  report: { differenceTotal?: number };
  batches: StockImportBatchRow[];
  replay?: boolean;
}> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/inventory/import/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `stock_import_preview_failed_${res.status}`);
  }
  return (await res.json()) as {
    batchId: string;
    report: { differenceTotal?: number };
    batches: StockImportBatchRow[];
    replay?: boolean;
  };
}

export async function commitStockImport(
  batchId: string,
): Promise<{ batches?: StockImportBatchRow[]; status?: string; replay?: boolean }> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/inventory/import/${encodeURIComponent(batchId)}/commit`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `stock_import_commit_failed_${res.status}`);
  }
  return (await res.json()) as {
    batches?: StockImportBatchRow[];
    status?: string;
    replay?: boolean;
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

export type SettlementCarryforwardRow = {
  carryforwardId: string;
  storeId: string;
  storeName: string;
  amountLak: number;
  sourceBatchId: string | null;
  status: string;
  collectionRequestId: string | null;
  collectionStatus: string | null;
  createdAt: string;
};

export async function listSettlementCarryforwards(
  limit = 50,
): Promise<SettlementCarryforwardRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/settlements/carryforwards?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`settlement_carryforwards_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { carryforwards: SettlementCarryforwardRow[] };
  return body.carryforwards;
}

export async function holdSettlementLine(
  batchId: string,
  input: { childOrderId?: string; reason?: string } = {},
): Promise<{
  batches?: SettlementBatchRow[];
  lines?: SettlementLineRow[];
  childOrderId?: string;
  holdReason?: string;
}> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/settlements/${batchId}/hold-line`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      child_order_id: input.childOrderId,
      reason: input.reason,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `settlement_hold_failed_${res.status}`);
  }
  return (await res.json()) as {
    batches?: SettlementBatchRow[];
    lines?: SettlementLineRow[];
    childOrderId?: string;
    holdReason?: string;
  };
}

export async function mockSettlementCarryforward(input: {
  storeId?: string;
  amountLak?: number;
  sourceBatchId?: string;
  collect?: boolean;
} = {}): Promise<{
  carryforwardId: string;
  collectionRequestId?: string;
  carryforwards?: SettlementCarryforwardRow[];
  amountLak?: number;
}> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/settlements/mock-carryforward`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      store_id: input.storeId,
      amount_lak: input.amountLak,
      source_batch_id: input.sourceBatchId,
      collect: input.collect,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `settlement_carryforward_failed_${res.status}`);
  }
  return (await res.json()) as {
    carryforwardId: string;
    collectionRequestId?: string;
    carryforwards?: SettlementCarryforwardRow[];
    amountLak?: number;
  };
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

export type DeliveryClaimRow = {
  claimId: string;
  deliveryId: string;
  childOrderId: string;
  claimType: string;
  status: string;
  liabilityParty: string | null;
  notes: string | null;
  deliveryStatus: string;
  trackingNumber: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export async function listDeliveryClaims(limit = 50): Promise<DeliveryClaimRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/delivery-claims?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`delivery_claims_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { claims: DeliveryClaimRow[] };
  return body.claims;
}

export async function mockOpenDeliveryClaim(input: {
  deliveryId?: string;
  claimType?: 'lost' | 'damaged';
  notes?: string;
} = {}): Promise<{
  claimId: string;
  liabilityParty?: string;
  claims?: DeliveryClaimRow[];
  status?: string;
}> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/delivery-claims/mock-open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      delivery_id: input.deliveryId,
      claim_type: input.claimType,
      notes: input.notes,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `delivery_claim_open_failed_${res.status}`);
  }
  return (await res.json()) as {
    claimId: string;
    liabilityParty?: string;
    claims?: DeliveryClaimRow[];
    status?: string;
  };
}

export async function resolveDeliveryClaim(
  claimId: string,
  input: { status?: 'resolved' | 'rejected'; notes?: string } = {},
): Promise<{ claims?: DeliveryClaimRow[]; status?: string }> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/delivery-claims/${encodeURIComponent(claimId)}/resolve`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status: input.status ?? 'resolved',
        notes: input.notes,
      }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `delivery_claim_resolve_failed_${res.status}`);
  }
  return (await res.json()) as { claims?: DeliveryClaimRow[]; status?: string };
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

export type PriceRequestRow = {
  requestId: string;
  priceVersionId: string;
  variantId: string;
  costLak: number;
  sellingPriceLak: number;
  marginLak: number;
  belowCost: boolean;
  versionStatus: string;
  status: string;
  makerIdentityId: string;
  approverIdentityId: string | null;
  requiresOwner: boolean;
  requires2fa: boolean;
  reason: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export async function listPriceRequests(limit = 50): Promise<PriceRequestRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/pricing/requests?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`pricing_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { requests: PriceRequestRow[] };
  return body.requests;
}

export async function mockProposePrice(input: {
  sellingPriceLak?: number;
  costLak?: number;
  belowCost?: boolean;
  reason?: string;
} = {}): Promise<{ requestId: string; belowCost: boolean; requests: PriceRequestRow[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/pricing/mock-propose`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `price_propose_failed_${res.status}`);
  }
  return (await res.json()) as {
    requestId: string;
    belowCost: boolean;
    requests: PriceRequestRow[];
  };
}

export async function approvePriceRequest(
  requestId: string,
): Promise<{ requests?: PriceRequestRow[]; status?: string }> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/pricing/${encodeURIComponent(requestId)}/approve`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stepUpVerified: true }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `price_approve_failed_${res.status}`);
  }
  return (await res.json()) as { requests?: PriceRequestRow[]; status?: string };
}

export type NearExpiryRequestRow = {
  requestId: string;
  variantId: string;
  proposedSellingPriceLak: number;
  reason: string;
  status: string;
  makerIdentityId: string;
  approverIdentityId: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export async function listNearExpiryRequests(
  limit = 50,
): Promise<NearExpiryRequestRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/pricing/near-expiry?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`near_expiry_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { requests: NearExpiryRequestRow[] };
  return body.requests;
}

export async function mockProposeNearExpiry(input: {
  proposedSellingPriceLak?: number;
  reason?: string;
} = {}): Promise<{
  requestId: string;
  linkedLotId?: string | null;
  requests: NearExpiryRequestRow[];
}> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/pricing/near-expiry/mock-propose`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `near_expiry_propose_failed_${res.status}`);
  }
  return (await res.json()) as {
    requestId: string;
    linkedLotId?: string | null;
    requests: NearExpiryRequestRow[];
  };
}

export async function approveNearExpiryRequest(
  requestId: string,
): Promise<{ requests?: NearExpiryRequestRow[]; status?: string }> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/pricing/near-expiry/${encodeURIComponent(requestId)}/approve`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `near_expiry_approve_failed_${res.status}`);
  }
  return (await res.json()) as { requests?: NearExpiryRequestRow[]; status?: string };
}

export type ReconMismatchRow = {
  mismatchId: string;
  mismatchType: string;
  referenceId: string;
  expectedLak: number;
  actualLak: number;
  status: string;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type PaymentAdjustmentRow = {
  adjustmentId: string;
  paymentRequestId: string | null;
  childOrderId: string | null;
  amountLak: number;
  reason: string;
  status: string;
  makerIdentityId: string;
  approverIdentityId: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export async function listReconMismatches(limit = 50): Promise<ReconMismatchRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/payments/mismatches?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`mismatches_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { mismatches: ReconMismatchRow[] };
  return body.mismatches;
}

export async function listPaymentAdjustments(
  limit = 50,
): Promise<PaymentAdjustmentRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/payments/adjustments?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`adjustments_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { adjustments: PaymentAdjustmentRow[] };
  return body.adjustments;
}

export async function mockCreateMismatch(input: {
  expectedLak?: number;
  actualLak?: number;
  mismatchType?: 'bank' | 'cod' | 'allocation';
} = {}): Promise<{ mismatchId: string; mismatches: ReconMismatchRow[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/payments/mismatches/mock-create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `mismatch_create_failed_${res.status}`);
  }
  return (await res.json()) as { mismatchId: string; mismatches: ReconMismatchRow[] };
}

export async function resolveReconMismatch(
  mismatchId: string,
  input: { note?: string; createAdjustment?: boolean; amountLak?: number } = {},
): Promise<{
  adjustmentId?: string;
  mismatches?: ReconMismatchRow[];
  adjustments?: PaymentAdjustmentRow[];
}> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/payments/mismatches/${encodeURIComponent(mismatchId)}/resolve`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `mismatch_resolve_failed_${res.status}`);
  }
  return (await res.json()) as {
    adjustmentId?: string;
    mismatches?: ReconMismatchRow[];
    adjustments?: PaymentAdjustmentRow[];
  };
}

export async function approvePaymentAdjustment(
  adjustmentId: string,
): Promise<{ adjustments?: PaymentAdjustmentRow[]; status?: string }> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/payments/adjustments/${encodeURIComponent(adjustmentId)}/approve`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `adjustment_approve_failed_${res.status}`);
  }
  return (await res.json()) as { adjustments?: PaymentAdjustmentRow[]; status?: string };
}

export type ContractVersionRow = {
  contractId: string;
  storeId: string;
  versionNo: number;
  revenueModel: string;
  markupBps: number | null;
  commissionBps: number | null;
  perOrderFeeLak: number | null;
  settlementCadence: string;
  customCadenceDays: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  createdBy: string | null;
};

export async function listContracts(limit = 50): Promise<ContractVersionRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/stores/contracts?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`contracts_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { contracts: ContractVersionRow[] };
  return body.contracts;
}

export async function mockCreateContract(input: {
  storeId?: string;
  commissionBps?: number;
} = {}): Promise<{ id: string; versionNo: number; contracts: ContractVersionRow[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/stores/contracts/mock-create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      storeId: input.storeId,
      commissionBps: input.commissionBps,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `contract_create_failed_${res.status}`);
  }
  return (await res.json()) as {
    id: string;
    versionNo: number;
    contracts: ContractVersionRow[];
  };
}

export type PayoutRequestRow = {
  requestId: string;
  storeId: string;
  requestedVersionId: string;
  makerIdentityId: string;
  approverIdentityId: string | null;
  status: string;
  requires2fa: boolean;
  createdAt: string;
  decidedAt: string | null;
  bankName: string;
  accountNumberLast4: string;
  accountHolder: string;
  versionStatus: string;
  payoutHoldUntil: string | null;
};

export type PayoutAccountRow = {
  versionId: string;
  storeId: string;
  versionNo: number;
  bankName: string;
  accountNumberLast4: string;
  accountHolder: string;
  status: string;
  activatedAt: string | null;
  payoutHoldUntil: string | null;
};

export async function listPayoutRequests(
  limit = 50,
): Promise<{ requests: PayoutRequestRow[]; accounts: PayoutAccountRow[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/payouts/requests?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`payouts_list_failed_${res.status}`);
  }
  return (await res.json()) as { requests: PayoutRequestRow[]; accounts: PayoutAccountRow[] };
}

export async function mockProposePayout(input: {
  storeId?: string;
  bankName?: string;
  accountNumberLast4?: string;
  accountHolder?: string;
} = {}): Promise<{
  requestId: string;
  requests: PayoutRequestRow[];
  accounts: PayoutAccountRow[];
}> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/payouts/mock-propose`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `payout_propose_failed_${res.status}`);
  }
  return (await res.json()) as {
    requestId: string;
    requests: PayoutRequestRow[];
    accounts: PayoutAccountRow[];
  };
}

export async function approvePayoutRequest(
  requestId: string,
): Promise<{
  requests?: PayoutRequestRow[];
  accounts?: PayoutAccountRow[];
  status?: string;
  holdUntil?: string;
}> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/payouts/${encodeURIComponent(requestId)}/approve`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stepUpVerified: true }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `payout_approve_failed_${res.status}`);
  }
  return (await res.json()) as {
    requests?: PayoutRequestRow[];
    accounts?: PayoutAccountRow[];
    status?: string;
    holdUntil?: string;
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

export async function mockLockStaff(input: {
  identityId?: string;
  subject?: string;
} = {}): Promise<{
  identityId: string;
  subject?: string;
  status: string;
  roles?: StaffRoleCatalogRow[];
  staff?: StaffDirectoryRow[];
}> {
  const res = await fetch(`${apiBaseUrl()}/v1/ops/identity/mock-lock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      identity_id: input.identityId,
      subject: input.subject,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `staff_lock_failed_${res.status}`);
  }
  return (await res.json()) as {
    identityId: string;
    subject?: string;
    status: string;
    roles?: StaffRoleCatalogRow[];
    staff?: StaffDirectoryRow[];
  };
}

export async function unlockStaff(
  identityId: string,
  input: { reason?: string } = {},
): Promise<{
  identityId: string;
  subject?: string;
  status: string;
  roles?: StaffRoleCatalogRow[];
  staff?: StaffDirectoryRow[];
}> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/staff/${encodeURIComponent(identityId)}/unlock`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: input.reason }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `staff_unlock_failed_${res.status}`);
  }
  return (await res.json()) as {
    identityId: string;
    subject?: string;
    status: string;
    roles?: StaffRoleCatalogRow[];
    staff?: StaffDirectoryRow[];
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

export type RecoveryRequestRow = {
  requestId: string;
  claimedPhoneE164: string;
  documentStorageKey: string;
  documentEncrypted: boolean;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
};

export async function listRecoveryRequests(limit = 50): Promise<RecoveryRequestRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/privacy/recovery-requests?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`recovery_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { requests: RecoveryRequestRow[] };
  return body.requests;
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

export type SupplierResponseRow = {
  responseId: string;
  reviewId: string;
  storeId: string;
  body: string;
  status: string;
  createdAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
};

export async function listSupplierResponses(
  limit = 50,
): Promise<SupplierResponseRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/reviews/responses?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`supplier_responses_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { responses: SupplierResponseRow[] };
  return body.responses;
}

export async function submitSupplierResponse(
  reviewId: string,
  bodyText: string,
): Promise<{ responseId: string; status: string; responses?: SupplierResponseRow[] }> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/reviews/${encodeURIComponent(reviewId)}/supplier-response`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: bodyText }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `supplier_response_failed_${res.status}`);
  }
  return (await res.json()) as {
    responseId: string;
    status: string;
    responses?: SupplierResponseRow[];
  };
}

export async function approveSupplierResponse(
  responseId: string,
): Promise<{ responses?: SupplierResponseRow[]; status?: string }> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/ops/reviews/responses/${encodeURIComponent(responseId)}/approve`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `supplier_response_approve_failed_${res.status}`);
  }
  return (await res.json()) as { responses?: SupplierResponseRow[]; status?: string };
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
