import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { verifyProxySignature } from './verifyProxySignature.js';

const SECRET = 'test_secret';

function sign(params: Record<string, string>, secret: string): string {
  const sorted = Object.keys(params)
    .filter((k) => k !== 'signature')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('');
  return createHmac('sha256', secret).update(sorted).digest('hex');
}

describe('verifyProxySignature', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts a valid signature', () => {
    const base = {
      shop: 'test.myshopify.com',
      logged_in_customer_id: '12345',
      path_prefix: 'apps',
      timestamp: String(Math.floor(Date.now() / 1000)),
    };
    const signature = sign(base, SECRET);
    const result = verifyProxySignature({ ...base, signature }, SECRET);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.shop).toBe('test.myshopify.com');
      expect(result.loggedInCustomerId).toBe('12345');
    }
  });

  it('rejects invalid signature', () => {
    const result = verifyProxySignature(
      {
        shop: 'test.myshopify.com',
        signature: 'invalid',
        timestamp: String(Math.floor(Date.now() / 1000)),
      },
      SECRET
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('invalid_signature');
    }
  });

  it('rejects expired timestamp', () => {
    const base = {
      shop: 'test.myshopify.com',
      timestamp: String(Math.floor(Date.now() / 1000) - 400),
    };
    const signature = sign(base, SECRET);
    const result = verifyProxySignature({ ...base, signature }, SECRET);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('expired_timestamp');
    }
  });

  it('rejects missing signature', () => {
    const result = verifyProxySignature({ shop: 'test.myshopify.com' }, SECRET);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('missing_signature');
    }
  });
});
