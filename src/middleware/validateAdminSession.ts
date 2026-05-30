import type { Request, Response, NextFunction } from 'express';
import { getShopifyAuth } from '../utils/shopifyAdmin.js';

export interface AdminRequest extends Request {
  shopDomain?: string;
}

function getSessionToken(req: Request): string | null {
  const header = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (header) return header;

  const urlToken = typeof req.query.id_token === 'string' ? req.query.id_token : null;
  return urlToken;
}

export function redirectToSessionTokenBounce(req: Request, res: Response): void {
  const searchParams = new URLSearchParams(req.query as Record<string, string>);
  searchParams.delete('id_token');
  searchParams.set('shopify-reload', `${req.path}?${searchParams.toString()}`);
  res.redirect(`/session-token-bounce?${searchParams.toString()}`);
}

export async function validateAdminSession(
  req: AdminRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = getSessionToken(req);
  if (!token) {
    if (!req.headers.authorization) {
      redirectToSessionTokenBounce(req, res);
      return;
    }
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    const shopify = getShopifyAuth();
    const payload = await shopify.session.decodeSessionToken(token);
    const dest = new URL(payload.dest);
    req.shopDomain = dest.hostname;
    next();
  } catch {
    if (!req.headers.authorization) {
      redirectToSessionTokenBounce(req, res);
      return;
    }
    res.setHeader('X-Shopify-Retry-Invalid-Session-Request', '1');
    res.status(401).json({ error: 'unauthorized' });
  }
}
