import { describe, expect, it } from 'vitest';

import {
  evaluateOtpRateLimit,
  hashOtp,
  otpAcceptedResponse,
  safeEqualHex,
  DEFAULT_OTP_RATE_LIMIT,
} from './otp.js';

describe('OTP helpers', () => {
  it('hashes codes stably', () => {
    expect(hashOtp('123456')).toBe(hashOtp('123456'));
    expect(safeEqualHex(hashOtp('123456'), hashOtp('123456'))).toBe(true);
  });

  it('anti-enumeration response hides existence', () => {
    const res = otpAcceptedResponse('corr-1');
    expect(res.message).toMatch(/If the account exists/i);
    expect(res).not.toHaveProperty('exists');
  });

  it('enforces rate limit, cooldown, and captcha threshold', () => {
    let state = undefined;
    const start = 1_000_000;
    for (let i = 0; i < DEFAULT_OTP_RATE_LIMIT.maxRequests; i += 1) {
      const result = evaluateOtpRateLimit(state, start + i, DEFAULT_OTP_RATE_LIMIT);
      expect(result.allow).toBe(true);
      state = result.next;
    }
    expect(state?.captchaRequired).toBe(true);
    const blocked = evaluateOtpRateLimit(state, start + 10, DEFAULT_OTP_RATE_LIMIT);
    expect(blocked.allow).toBe(false);
    expect(blocked.reason).toBe('rate_limited');
  });
});
