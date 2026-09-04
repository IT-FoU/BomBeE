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

export type CheckoutResult = {
  ok: true;
  parentId: string;
  orderNumber: string;
  childIds: string[];
};

export type OrderView = {
  ok: true;
  combined: {
    id: string;
    order_number: string;
    status: string;
    total_lak: number | string;
  };
  byStore: Array<{
    id: string;
    store_id: string;
    status: string;
    total_lak: number | string;
  }>;
};

export async function checkoutLocalCart(input: {
  sessionToken: string;
  lines: Array<{ storeId: string; variantId: string; quantity: number }>;
  shippingLakByStore?: Record<string, number>;
}): Promise<CheckoutResult> {
  const cartRes = await fetch(`${apiBaseUrl()}/v1/carts`, {
    method: 'POST',
    headers: authHeaders(input.sessionToken),
    body: '{}',
  });
  if (!cartRes.ok) {
    const err = (await cartRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `cart_create_failed_${cartRes.status}`);
  }
  const { cartId } = (await cartRes.json()) as { cartId: string };

  for (const line of input.lines) {
    const itemRes = await fetch(`${apiBaseUrl()}/v1/carts/${cartId}/items`, {
      method: 'POST',
      headers: authHeaders(input.sessionToken),
      body: JSON.stringify(line),
    });
    if (!itemRes.ok) {
      const err = (await itemRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `cart_item_failed_${itemRes.status}`);
    }
  }

  const checkoutRes = await fetch(`${apiBaseUrl()}/v1/carts/${cartId}/checkout`, {
    method: 'POST',
    headers: authHeaders(input.sessionToken),
    body: JSON.stringify({ shippingLakByStore: input.shippingLakByStore ?? {} }),
  });
  if (!checkoutRes.ok) {
    const err = (await checkoutRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `checkout_failed_${checkoutRes.status}`);
  }
  return (await checkoutRes.json()) as CheckoutResult;
}

export async function fetchOrderView(
  sessionToken: string,
  parentId: string,
): Promise<OrderView> {
  const res = await fetch(`${apiBaseUrl()}/v1/orders/${parentId}`, {
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `order_view_failed_${res.status}`);
  }
  return (await res.json()) as OrderView;
}
