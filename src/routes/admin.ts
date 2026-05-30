import type { Response } from 'express';
import type { AdminRequest } from '../middleware/validateAdminSession.js';
import {
  getOfflineSession,
  listRecentQuoteDraftOrders,
} from '../utils/shopifyAdmin.js';
import { logger } from '../utils/logger.js';

const PROXY_PATH = '/apps/create-b2b-draft-order';

export async function handleAdminStatus(req: AdminRequest, res: Response): Promise<void> {
  const shop = req.shopDomain;
  if (!shop) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    const session = await getOfflineSession(shop);
    const connected = Boolean(session?.accessToken);

    let quotes: Awaited<ReturnType<typeof listRecentQuoteDraftOrders>> = [];
    if (connected && session) {
      try {
        quotes = await listRecentQuoteDraftOrders(session, shop);
      } catch (err) {
        logger.warn('Failed to list draft orders', {
          shop,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    res.json({
      connected,
      shop,
      proxyPath: PROXY_PATH,
      authUrl: connected ? undefined : `/auth?shop=${encodeURIComponent(shop)}`,
      quotes,
    });
  } catch (err) {
    logger.error('Admin status failed', {
      shop,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'internal_error' });
  }
}
