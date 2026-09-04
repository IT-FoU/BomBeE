const DEFAULT_API = 'http://localhost:8787';

export function apiBaseUrl(): string {
  // Prefer same-origin vite proxy in local dev when unset
  if (import.meta.env.VITE_PUBLIC_API_URL) {
    return String(import.meta.env.VITE_PUBLIC_API_URL).replace(/\/$/, '');
  }
  if (typeof window !== 'undefined' && window.location.port === '5173') {
    return '';
  }
  return DEFAULT_API;
}

export type OtpRequestResult = {
  status: string;
  correlationId?: string;
  limited?: boolean;
  captchaRequired?: boolean;
  devCode?: string;
  message?: string;
};

export type OtpVerifyResult = {
  ok: true;
  sessionToken: string;
  expiresAt: string;
  identityId: string;
};

export async function requestCustomerOtp(
  phoneE164: string,
  inviteCode?: string,
): Promise<OtpRequestResult> {
  const res = await fetch(`${apiBaseUrl()}/v1/auth/otp/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      phoneE164,
      purpose: 'customer_login',
      ...(inviteCode ? { inviteCode } : {}),
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `otp_request_failed_${res.status}`);
  }
  return (await res.json()) as OtpRequestResult;
}

export async function verifyCustomerOtp(
  phoneE164: string,
  code: string,
): Promise<OtpVerifyResult> {
  const res = await fetch(`${apiBaseUrl()}/v1/auth/otp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phoneE164, purpose: 'customer_login', code }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `otp_verify_failed_${res.status}`);
  }
  return (await res.json()) as OtpVerifyResult;
}

export type SessionMe = {
  ok: true;
  sessionId: string;
  identityId: string;
  audience: string;
  expiresAt: string;
  phoneE164: string | null;
  displayName: string | null;
};

export async function fetchSessionMe(sessionToken: string): Promise<SessionMe> {
  const res = await fetch(`${apiBaseUrl()}/v1/auth/me`, {
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `session_me_failed_${res.status}`);
  }
  return (await res.json()) as SessionMe;
}

export async function logoutSession(sessionToken: string): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/v1/auth/logout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionToken }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `logout_failed_${res.status}`);
  }
}
