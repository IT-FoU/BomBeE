const DEFAULT_API = 'http://localhost:8787';

export function apiBaseUrl(): string {
  if (import.meta.env.VITE_PUBLIC_API_URL) {
    return String(import.meta.env.VITE_PUBLIC_API_URL).replace(/\/$/, '');
  }
  if (typeof window !== 'undefined' && window.location.port === '5173') {
    return '';
  }
  return DEFAULT_API;
}

function authHeaders(sessionToken: string): HeadersInit {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${sessionToken}`,
  };
}

export type QrPayment = {
  paymentRequestId: string;
  referenceCode: string;
  amountLak: number;
  expiresAt: string;
};

export async function confirmChildrenMock(
  sessionToken: string,
  parentId: string,
  childOrderIds?: string[],
): Promise<string[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/orders/${parentId}/confirm-children`, {
    method: 'POST',
    headers: authHeaders(sessionToken),
    body: JSON.stringify(childOrderIds ? { childOrderIds } : {}),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `confirm_children_failed_${res.status}`);
  }
  const body = (await res.json()) as { confirmedChildIds: string[] };
  return body.confirmedChildIds;
}

export async function createQrPayment(
  sessionToken: string,
  parentId: string,
  childOrderIds?: string[],
): Promise<QrPayment> {
  const res = await fetch(`${apiBaseUrl()}/v1/orders/${parentId}/payments/qr`, {
    method: 'POST',
    headers: authHeaders(sessionToken),
    body: JSON.stringify(childOrderIds ? { childOrderIds } : {}),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `qr_create_failed_${res.status}`);
  }
  return (await res.json()) as QrPayment;
}

export async function mockConfirmPayment(
  sessionToken: string,
  paymentRequestId: string,
): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/payments/${paymentRequestId}/mock-confirm`, {
    method: 'POST',
    headers: authHeaders(sessionToken),
    body: '{}',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `mock_confirm_failed_${res.status}`);
  }
}

export async function fetchPaymentStatus(
  sessionToken: string,
  paymentRequestId: string,
): Promise<{ status: string; referenceCode: string; amountLak: number }> {
  const res = await fetch(`${apiBaseUrl()}/v1/payments/${paymentRequestId}`, {
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `payment_status_failed_${res.status}`);
  }
  const body = (await res.json()) as {
    payment: { status: string; referenceCode: string; amountLak: number };
  };
  return body.payment;
}
