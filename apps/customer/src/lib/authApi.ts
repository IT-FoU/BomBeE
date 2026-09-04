const DEFAULT_API = 'http://localhost:8787';

export function apiBaseUrl(): string {
  return (import.meta.env.VITE_PUBLIC_API_URL as string | undefined) || DEFAULT_API;
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

export async function requestCustomerOtp(phoneE164: string): Promise<OtpRequestResult> {
  const res = await fetch(`${apiBaseUrl()}/v1/auth/otp/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phoneE164, purpose: 'customer_login' }),
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
