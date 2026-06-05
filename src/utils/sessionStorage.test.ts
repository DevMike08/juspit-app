import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Session } from '@shopify/shopify-api';

const mockQuery = vi.fn();

vi.mock('pg', () => ({
  default: {
    Pool: vi.fn(() => ({
      query: mockQuery,
    })),
  },
}));

import {
  initSessionStorage,
  storeSession,
  loadSession,
  deleteSessionsByShop,
  resetSessionStorageForTests,
} from './sessionStorage.js';

const offlineSession = new Session({
  id: 'offline_tienda.myshopify.com',
  shop: 'tienda.myshopify.com',
  state: '',
  isOnline: false,
  scope: 'write_draft_orders',
  accessToken: 'shpat_test_token',
});

describe('sessionStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStorageForTests();
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });
  });

  it('initSessionStorage creates table and index', async () => {
    await initSessionStorage();

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS shopify_sessions');
    expect(mockQuery.mock.calls[1][0]).toContain('CREATE INDEX IF NOT EXISTS');
  });

  it('storeSession performs upsert', async () => {
    await storeSession(offlineSession);

    expect(mockQuery).toHaveBeenCalledOnce();
    expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO shopify_sessions');
    expect(mockQuery.mock.calls[0][0]).toContain('ON CONFLICT');
    expect(mockQuery.mock.calls[0][1]).toEqual([
      offlineSession.id,
      offlineSession.shop,
      offlineSession.state,
      offlineSession.isOnline,
      offlineSession.scope,
      offlineSession.expires ?? null,
      offlineSession.accessToken,
      null,
    ]);
  });

  it('loadSession returns Session when row exists', async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: offlineSession.id,
          shop: offlineSession.shop,
          state: '',
          is_online: false,
          scope: 'write_draft_orders',
          expires: null,
          access_token: 'shpat_test_token',
          online_access_info: null,
        },
      ],
    });

    const session = await loadSession(offlineSession.id);

    expect(session).not.toBeNull();
    expect(session?.id).toBe(offlineSession.id);
    expect(session?.accessToken).toBe('shpat_test_token');
  });

  it('loadSession returns null when row missing', async () => {
    const session = await loadSession('offline_missing.myshopify.com');

    expect(session).toBeNull();
  });

  it('deleteSessionsByShop deletes by shop', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await deleteSessionsByShop('tienda.myshopify.com');

    expect(mockQuery).toHaveBeenCalledWith(
      'DELETE FROM shopify_sessions WHERE shop = $1',
      ['tienda.myshopify.com']
    );
  });
});
