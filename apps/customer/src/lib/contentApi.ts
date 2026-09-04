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

export async function createReview(
  sessionToken: string,
  input: {
    productId: string;
    childOrderId: string;
    rating: number;
    bodyEn?: string;
    bodyLo?: string;
  },
): Promise<{ reviewId: string; status: string; reviews?: ReviewRow[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/reviews`, {
    method: 'POST',
    headers: authHeaders(sessionToken),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `review_create_failed_${res.status}`);
  }
  return (await res.json()) as { reviewId: string; status: string; reviews?: ReviewRow[] };
}

export async function editReview(
  sessionToken: string,
  reviewId: string,
  input: { rating: number; bodyEn?: string; bodyLo?: string },
): Promise<{ reviewId: string; versionNo: number; reviews?: ReviewRow[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/reviews/${encodeURIComponent(reviewId)}`, {
    method: 'PATCH',
    headers: authHeaders(sessionToken),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `review_edit_failed_${res.status}`);
  }
  return (await res.json()) as {
    reviewId: string;
    versionNo: number;
    reviews?: ReviewRow[];
  };
}

export async function listTikTokLinks(limit = 50): Promise<TikTokLinkRow[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/tiktok-links?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`tiktok_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { links: TikTokLinkRow[] };
  return body.links;
}

export async function submitTikTokLink(
  sessionToken: string,
  input: { url: string; productId?: string },
): Promise<{ linkId: string; status: string; links?: TikTokLinkRow[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/tiktok-links`, {
    method: 'POST',
    headers: authHeaders(sessionToken),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `tiktok_submit_failed_${res.status}`);
  }
  return (await res.json()) as { linkId: string; status: string; links?: TikTokLinkRow[] };
}
