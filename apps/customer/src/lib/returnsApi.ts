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

export type MyReturnRow = {
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

export async function listMyReturns(
  sessionToken: string,
  limit = 50,
): Promise<MyReturnRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/me/returns?limit=${limit}`, {
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `returns_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { returns: MyReturnRow[] };
  return body.returns;
}

export async function requestMyReturn(
  sessionToken: string,
  input: {
    childOrderId: string;
    reason?: string;
    evidenceKeys?: string[];
  },
): Promise<{
  returnRequestId: string;
  shippingLiability?: string;
  returns?: MyReturnRow[];
}> {
  const res = await fetch(`${apiBaseUrl()}/v1/me/returns`, {
    method: 'POST',
    headers: authHeaders(sessionToken),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `return_request_failed_${res.status}`);
  }
  return (await res.json()) as {
    returnRequestId: string;
    shippingLiability?: string;
    returns?: MyReturnRow[];
  };
}
