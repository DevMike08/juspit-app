import type { Request, Response } from 'express';
import { verifyProxySignature, type ProxyQueryParams } from '../utils/verifyProxySignature.js';
import {
  getOfflineSession,
  getCustomerForDraftOrder,
  createQuoteDraftOrder,
  type CartLineItem,
} from '../utils/shopifyAdmin.js';
import { getCachedDraft, setCachedDraft } from '../utils/idempotency.js';
import { logger } from '../utils/logger.js';

export interface QuoteRequestBody {
  items?: CartLineItem[];
  cart_token?: string;
  note?: string;
}

function jsonError(res: Response, status: number, error: string, message?: string): void {
  res.status(status).json({
    success: false,
    error,
    message: message || error,
  });
}

/**
 * POST /api/proxy — App Proxy para crear Draft Order de cotización B2B.
 * Shopify reenvía query params (shop, logged_in_customer_id, signature, …).
 */
export async function handleCreateB2bDraftOrder(req: Request, res: Response): Promise<void> {
  const start = Date.now();
  const apiSecret = process.env.SHOPIFY_API_SECRET;

  if (!apiSecret) {
    logger.error('SHOPIFY_API_SECRET not configured');
    jsonError(res, 500, 'server_misconfigured');
    return;
  }

  const query = req.query as ProxyQueryParams;
  const verification = verifyProxySignature(query, apiSecret);

  if (!verification.valid) {
    logger.warn('App proxy signature failed', { reason: verification.reason });
    jsonError(res, 401, 'invalid_signature', verification.reason);
    return;
  }

  const { shop, loggedInCustomerId } = verification;

  if (!loggedInCustomerId) {
    logger.warn('No logged_in_customer_id', { shop });
    jsonError(res, 401, 'customer_not_authenticated', 'Debe iniciar sesión como cliente B2B.');
    return;
  }

  const body = (req.body || {}) as QuoteRequestBody;
  const items = body.items;
  const cartToken = body.cart_token?.trim();

  if (!items || !Array.isArray(items) || items.length === 0) {
    jsonError(res, 400, 'empty_cart', 'El carrito no tiene productos.');
    return;
  }

  for (const item of items) {
    if (!item.variant_id || !item.quantity || item.quantity < 1) {
      jsonError(res, 400, 'invalid_cart', 'Línea de carrito inválida.');
      return;
    }
    if (typeof item.price !== 'number' || item.price < 0) {
      jsonError(res, 400, 'invalid_cart', 'Precio de línea inválido.');
      return;
    }
  }

  if (cartToken) {
    const cached = getCachedDraft(shop, cartToken);
    if (cached) {
      logger.info('Returning cached draft (idempotency)', { shop, cartToken });
      res.json({
        success: true,
        draft_order_id: cached.draftOrderId,
        invoice_url: cached.invoiceUrl,
        cached: true,
      });
      return;
    }
  }

  const session = await getOfflineSession(shop);
  if (!session) {
    logger.error('No offline session for shop', { shop });
    jsonError(res, 503, 'app_not_installed', 'La app no está instalada en esta tienda.');
    return;
  }

  const customerId = Number(loggedInCustomerId);
  if (Number.isNaN(customerId)) {
    jsonError(res, 401, 'customer_not_authenticated');
    return;
  }

  try {
    const customer = await getCustomerForDraftOrder(session, customerId);
    if (!customer) {
      jsonError(res, 404, 'customer_not_found');
      return;
    }

    const result = await createQuoteDraftOrder(session, {
      customerGid: customer.id,
      items,
      cartToken: cartToken || `anon-${Date.now()}`,
      cartNote: body.note,
      customer,
    });

    if (cartToken) {
      setCachedDraft(shop, cartToken, result.id, result.invoiceUrl);
    }

    const durationMs = Date.now() - start;
    logger.info('Draft order created', {
      shop,
      customerId: String(customerId),
      draftOrderId: result.id,
      durationMs,
      cartToken,
    });

    res.json({
      success: true,
      draft_order_id: result.id,
      invoice_url: result.invoiceUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to create draft order', {
      shop,
      customerId: loggedInCustomerId,
      error: message,
      durationMs: Date.now() - start,
    });
    jsonError(res, 502, 'draft_order_failed', message);
  }
}
