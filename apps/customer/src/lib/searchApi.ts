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

export type SearchMatch = {
  variantId: string;
  sku: string;
  barcode: string | null;
  titleEn: string;
  titleLo: string;
};

export async function searchCatalog(input: {
  q?: string;
  barcode?: string;
}): Promise<SearchMatch[]> {
  const params = new URLSearchParams();
  if (input.q?.trim()) params.set('q', input.q.trim());
  if (input.barcode?.trim()) params.set('barcode', input.barcode.trim());
  const res = await fetch(`${apiBaseUrl()}/v1/search/catalog?${params.toString()}`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `search_catalog_failed_${res.status}`);
  }
  const body = (await res.json()) as { matches: SearchMatch[] };
  return body.matches;
}

export async function searchByImageMeta(input: {
  sessionToken?: string;
  contentType?: string;
  byteSize?: number;
  ocrText?: string;
  barcodeValue?: string;
}): Promise<{ matches: SearchMatch[]; uploadId: string }> {
  const headers: HeadersInit = { 'content-type': 'application/json' };
  if (input.sessionToken) {
    headers.authorization = `Bearer ${input.sessionToken}`;
  }
  const res = await fetch(`${apiBaseUrl()}/v1/search/image`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      contentType: input.contentType ?? 'image/jpeg',
      byteSize: input.byteSize ?? 1024,
      consentSearchOnly: true,
      ocrText: input.ocrText,
      barcodeValue: input.barcodeValue,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `image_search_failed_${res.status}`);
  }
  const body = (await res.json()) as {
    matches: SearchMatch[];
    upload: { id: string };
  };
  return { matches: body.matches, uploadId: body.upload.id };
}
