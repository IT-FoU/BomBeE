const TIKTOK_HOST_ALLOWLIST = new Set(['www.tiktok.com', 'tiktok.com', 'vm.tiktok.com']);

export const REVIEW_WRITE_DAYS = 30;
export const REVIEW_EDIT_DAYS = 7;

export function assertVerifiedReviewWindow(input: {
  childStatus: string;
  deliveredAt: Date;
  now: Date;
}): void {
  if (input.childStatus !== 'delivered') throw new Error('review_requires_delivered');
  const ms = input.now.getTime() - input.deliveredAt.getTime();
  if (ms < 0 || ms > REVIEW_WRITE_DAYS * 24 * 60 * 60_000) {
    throw new Error('review_window_exceeded');
  }
}

export function assertReviewEditable(createdAt: Date, now: Date): void {
  if (now.getTime() - createdAt.getTime() > REVIEW_EDIT_DAYS * 24 * 60 * 60_000) {
    throw new Error('review_edit_window_exceeded');
  }
}

export function validateTikTokUrl(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'https_required' };
  if (!TIKTOK_HOST_ALLOWLIST.has(parsed.hostname.toLowerCase())) {
    return { ok: false, reason: 'host_not_allowed' };
  }
  // block open redirects via awkward userinfo/path tricks
  if (parsed.username || parsed.password) return { ok: false, reason: 'userinfo_forbidden' };
  return { ok: true, url: parsed.toString() };
}

export function looksSuspicious(text: string): boolean {
  const lowered = text.toLowerCase();
  return (
    lowered.includes('http://') ||
    lowered.includes('javascript:') ||
    lowered.includes('free money') ||
    lowered.includes('click here')
  );
}
