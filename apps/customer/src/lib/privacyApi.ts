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

export type PrivacyProfile = {
  displayName: string;
  marketingOptIn: boolean;
  phoneE164: string | null;
};

export type PrivacyAddress = {
  addressId: string;
  label: string | null;
  recipientName: string;
  recipientPhoneE164: string;
  addressLine: string;
  district: string | null;
  province: string | null;
  isDefault: boolean;
};

export async function fetchMyPrivacy(
  sessionToken: string,
): Promise<{ profile: PrivacyProfile; addresses: PrivacyAddress[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/me/privacy`, {
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `privacy_failed_${res.status}`);
  }
  return (await res.json()) as { profile: PrivacyProfile; addresses: PrivacyAddress[] };
}

export async function addMyAddress(
  sessionToken: string,
  input: {
    recipientName: string;
    recipientPhoneE164: string;
    addressLine: string;
    label?: string;
    isDefault?: boolean;
  },
): Promise<{ addressId: string; addresses: PrivacyAddress[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/me/addresses`, {
    method: 'POST',
    headers: authHeaders(sessionToken),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `address_failed_${res.status}`);
  }
  return (await res.json()) as { addressId: string; addresses: PrivacyAddress[] };
}

export async function setMarketingOptIn(
  sessionToken: string,
  optIn: boolean,
): Promise<PrivacyProfile> {
  const res = await fetch(`${apiBaseUrl()}/v1/me/marketing-opt-in`, {
    method: 'POST',
    headers: authHeaders(sessionToken),
    body: JSON.stringify({ optIn }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `marketing_opt_failed_${res.status}`);
  }
  const body = (await res.json()) as { profile: PrivacyProfile };
  return body.profile;
}

export async function requestAccountDeletion(sessionToken: string): Promise<string> {
  const res = await fetch(`${apiBaseUrl()}/v1/me/deletion-request`, {
    method: 'POST',
    headers: authHeaders(sessionToken),
    body: JSON.stringify({ otpVerified: true }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `deletion_request_failed_${res.status}`);
  }
  const body = (await res.json()) as { requestId: string };
  return body.requestId;
}

export async function startPhoneChange(
  sessionToken: string,
  newPhone: string,
): Promise<{ correlationId: string; devOldCode?: string; devNewCode?: string }> {
  const res = await fetch(`${apiBaseUrl()}/v1/me/phone-change/start`, {
    method: 'POST',
    headers: authHeaders(sessionToken),
    body: JSON.stringify({ newPhone }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `phone_change_start_failed_${res.status}`);
  }
  return (await res.json()) as {
    correlationId: string;
    devOldCode?: string;
    devNewCode?: string;
  };
}

export async function confirmPhoneChange(
  sessionToken: string,
  input: { correlationId: string; oldCode: string; newCode: string },
): Promise<PrivacyProfile> {
  const res = await fetch(`${apiBaseUrl()}/v1/me/phone-change/confirm`, {
    method: 'POST',
    headers: authHeaders(sessionToken),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `phone_change_confirm_failed_${res.status}`);
  }
  const body = (await res.json()) as { profile: PrivacyProfile };
  return body.profile;
}

export async function submitRecoveryDocument(input: {
  claimedPhone: string;
  documentStorageKey?: string;
}): Promise<string> {
  const res = await fetch(`${apiBaseUrl()}/v1/me/recovery-document`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `recovery_submit_failed_${res.status}`);
  }
  const body = (await res.json()) as { requestId: string };
  return body.requestId;
}
