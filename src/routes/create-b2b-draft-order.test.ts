import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { handleCreateB2bDraftOrder } from './create-b2b-draft-order.js';

vi.mock('../utils/verifyProxySignature.js', () => ({
  verifyProxySignature: vi.fn(),
}));

vi.mock('../utils/shopifyAdmin.js', () => ({
  getOfflineSession: vi.fn(),
  getCustomerForDraftOrder: vi.fn(),
  createQuoteDraftOrder: vi.fn(),
}));

vi.mock('../utils/idempotency.js', () => ({
  getCachedDraft: vi.fn(() => null),
  setCachedDraft: vi.fn(),
}));

import { verifyProxySignature } from '../utils/verifyProxySignature.js';

function mockRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: unknown) {
      this.body = data;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: Record<string, unknown> };
}

describe('handleCreateB2bDraftOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHOPIFY_API_SECRET = 'secret';
  });

  it('returns 401 when customer is not authenticated', async () => {
    vi.mocked(verifyProxySignature).mockReturnValue({
      valid: true,
      shop: 'test.myshopify.com',
      loggedInCustomerId: null,
    });

    const req = { query: {}, body: { items: [{ variant_id: 1, quantity: 1, price: 1000 }] } } as Request;
    const res = mockRes();

    await handleCreateB2bDraftOrder(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('customer_not_authenticated');
  });

  it('returns 400 for empty cart', async () => {
    vi.mocked(verifyProxySignature).mockReturnValue({
      valid: true,
      shop: 'test.myshopify.com',
      loggedInCustomerId: '1',
    });

    const req = { query: {}, body: { items: [] } } as Request;
    const res = mockRes();

    await handleCreateB2bDraftOrder(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('empty_cart');
  });
});
