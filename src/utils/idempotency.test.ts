import { describe, it, expect, beforeEach } from 'vitest';
import { getCachedDraft, setCachedDraft, clearIdempotencyCache } from './idempotency.js';

describe('idempotency cache', () => {
  beforeEach(() => {
    clearIdempotencyCache();
  });

  it('returns cached draft within TTL', () => {
    setCachedDraft('shop.myshopify.com', 'token-abc', 'gid://shopify/DraftOrder/1', 'https://invoice.url');
    const cached = getCachedDraft('shop.myshopify.com', 'token-abc');
    expect(cached).toEqual({
      draftOrderId: 'gid://shopify/DraftOrder/1',
      invoiceUrl: 'https://invoice.url',
    });
  });

  it('returns null for unknown token', () => {
    expect(getCachedDraft('shop.myshopify.com', 'unknown')).toBeNull();
  });
});
