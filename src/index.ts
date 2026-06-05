import 'dotenv/config';
import express from 'express';
import { handleCreateB2bDraftOrder } from './routes/create-b2b-draft-order.js';
import { handleAdminStatus } from './routes/admin.js';
import {
  getShopifyAuth,
  storeSession,
  getOfflineSession,
  deleteSessionsByShop,
} from './utils/shopifyAdmin.js';
import { initSessionStorage } from './utils/sessionStorage.js';
import { logger } from './utils/logger.js';
import { embeddedCsp } from './middleware/embeddedCsp.js';
import { validateAdminSession } from './middleware/validateAdminSession.js';
import { serveAdminPage, serveSessionTokenBounce } from './utils/serveAdminPage.js';

const PORT = Number(process.env.PORT || 3000);
const app = express();

app.use(embeddedCsp);

/** Webhook requiere body raw para validación HMAC — antes de express.json() */
app.post(
  '/webhooks/app-uninstalled',
  express.text({ type: 'application/json' }),
  async (req, res) => {
    try {
      const shopify = getShopifyAuth();
      const validation = await shopify.webhooks.validate({
        rawBody: req.body,
        rawRequest: req,
        rawResponse: res,
      });

      if (!validation.valid) {
        logger.error('Webhook validation failed', { reason: validation.reason });
        res.status(401).send('Unauthorized');
        return;
      }

      if (validation.topic === 'APP_UNINSTALLED') {
        await deleteSessionsByShop(validation.domain);
        logger.info('App uninstalled, sessions removed', { shop: validation.domain });
      }

      res.status(200).send('OK');
    } catch (err) {
      logger.error('Webhook handler failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).send('Internal error');
    }
  }
);

app.use(express.json());

/** App embebida en Shopify Admin */
app.get('/', (_req, res) => {
  serveAdminPage(res);
});

app.get('/session-token-bounce', (_req, res) => {
  serveSessionTokenBounce(res);
});

app.get('/api/admin/status', validateAdminSession, handleAdminStatus);

app.get('/health', async (_req, res) => {
  const shop = process.env.SHOPIFY_SHOP || '8675b1-fa.myshopify.com';
  const configured = Boolean(
    process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET && process.env.HOST
  );

  let sessionInstalled = false;
  let storageError: string | undefined;

  try {
    const session = await getOfflineSession(shop);
    sessionInstalled = Boolean(session?.accessToken);
  } catch (err) {
    storageError = err instanceof Error ? err.message : String(err);
    logger.error('Health check session lookup failed', { shop, error: storageError });
  }

  if (storageError) {
    res.status(503).json({
      ok: false,
      service: 'juspit-b2b-quote-app',
      configured,
      sessionInstalled: false,
      sessionStorage: 'postgresql',
      shop,
      error: storageError,
    });
    return;
  }

  res.json({
    ok: true,
    service: 'juspit-b2b-quote-app',
    configured,
    sessionInstalled,
    sessionStorage: 'postgresql',
    shop,
    warning: sessionInstalled
      ? undefined
      : 'No offline session. Reinstall: /auth?shop=' + shop,
  });
});

/** OAuth: inicio de instalación */
app.get('/auth', async (req, res) => {
  try {
    const shop = req.query.shop as string;
    if (!shop) {
      res.status(400).send('Missing shop parameter');
      return;
    }

    const shopify = getShopifyAuth();
    await shopify.auth.begin({
      shop: shopify.utils.sanitizeShop(shop, true)!,
      callbackPath: '/auth/callback',
      isOnline: false,
      rawRequest: req,
      rawResponse: res,
    });
  } catch (err) {
    logger.error('Auth begin failed', { error: String(err) });
    res.status(500).send('Auth error');
  }
});

/** OAuth: callback tras aprobar scopes */
app.get('/auth/callback', async (req, res) => {
  try {
    const shopify = getShopifyAuth();
    const callback = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });

    await storeSession(callback.session);
    logger.info('Offline session created', {
      shop: callback.session.shop,
      sessionId: callback.session.id,
      hasAccessToken: Boolean(callback.session.accessToken),
    });

    res.redirect(`https://${callback.session.shop}/admin/apps`);
  } catch (err) {
    logger.error('Auth callback failed', { error: String(err) });
    res.status(500).send('Auth callback error');
  }
});

/**
 * App Proxy endpoint.
 * Configuración: prefix=apps, subpath=create-b2b-draft-order
 * Storefront: POST https://{shop}/apps/create-b2b-draft-order
 */
app.post('/api/proxy', handleCreateB2bDraftOrder);
app.post('/api/proxy/create-b2b-draft-order', handleCreateB2bDraftOrder);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message });
  res.status(500).json({ success: false, error: 'internal_error' });
});

async function main(): Promise<void> {
  await initSessionStorage();
  app.listen(PORT, () => {
    logger.info(`Server listening on port ${PORT}`);
  });
}

main().catch((err) => {
  logger.error('Failed to start server', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
