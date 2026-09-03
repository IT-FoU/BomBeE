import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

export type OtpPurpose =
  | 'customer_login'
  | 'staff_login'
  | 'staff_new_device'
  | 'phone_change_old'
  | 'phone_change_new'
  | 'step_up_2fa'
  | 'account_recovery';

export type SmsProvider = {
  sendOtp: (input: { phoneE164: string; code: string; purpose: OtpPurpose }) => Promise<void>;
};

export class MockSmsProvider implements SmsProvider {
  readonly sent: Array<{ phoneE164: string; code: string; purpose: OtpPurpose }> = [];

  async sendOtp(input: { phoneE164: string; code: string; purpose: OtpPurpose }): Promise<void> {
    this.sent.push(input);
  }
}

export function hashOtp(code: string, salt = 'bombee-otp'): string {
  return createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type RateLimitConfig = {
  windowMs: number;
  maxRequests: number;
  cooldownMs: number;
  captchaAfter: number;
};

export const DEFAULT_OTP_RATE_LIMIT: RateLimitConfig = {
  windowMs: 10 * 60_000,
  maxRequests: 5,
  cooldownMs: 15 * 60_000,
  captchaAfter: 3,
};

export type RateLimitState = {
  bucketKey: string;
  windowStartedAt: number;
  requestCount: number;
  cooldownUntil?: number;
  captchaRequired: boolean;
};

export function evaluateOtpRateLimit(
  state: RateLimitState | undefined,
  now: number,
  config: RateLimitConfig = DEFAULT_OTP_RATE_LIMIT,
): { allow: boolean; next: RateLimitState; reason?: string } {
  if (state?.cooldownUntil && now < state.cooldownUntil) {
    return {
      allow: false,
      next: state,
      reason: 'cooldown',
    };
  }

  const windowExpired = !state || now - state.windowStartedAt >= config.windowMs;
  const base: RateLimitState = windowExpired
    ? {
        bucketKey: state?.bucketKey ?? 'unknown',
        windowStartedAt: now,
        requestCount: 0,
        captchaRequired: false,
      }
    : { ...state };

  if (base.requestCount >= config.maxRequests) {
    return {
      allow: false,
      next: {
        ...base,
        cooldownUntil: now + config.cooldownMs,
        captchaRequired: true,
      },
      reason: 'rate_limited',
    };
  }

  const requestCount = base.requestCount + 1;
  return {
    allow: true,
    next: {
      ...base,
      requestCount,
      captchaRequired: requestCount >= config.captchaAfter,
      cooldownUntil: undefined,
    },
  };
}

/** Anti-enumeration: same response shape whether the phone exists or not. */
export function otpAcceptedResponse(correlationId: string) {
  return {
    status: 'accepted' as const,
    message: 'If the account exists, an OTP was sent.',
    correlationId,
  };
}
