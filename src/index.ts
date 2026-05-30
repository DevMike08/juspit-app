import 'dotenv/config';
import express from 'express';
import { handleCreateB2bDraftOrder } from './routes/create-b2b-draft-order.js';
import { handleAdminStatus } from './routes/admin.js';
import { getShopifyAuth, storeSession, getOfflineSession } from './utils/shopifyAdmin.js';
import { logger } from './utils/logger.js';
import { embeddedCsp } from './middleware/embeddedCsp.js';
import { validateAdminSession } from './middleware/validateAdminSession.js';
import { serveAdminPage, serveSessionTokenBounce } from './utils/serveAdminPage.js';

const PORT = Number(process.env.PORT || 3000);
const app = express();

app.use(embeddedCsp);
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
  let sessionInstalled = false;
  try {
    const session = await getOfflineSession(shop);
    sessionInstalled = Boolean(session?.accessToken);
  } catch {
    sessionInstalled = false;
  }

  const configured = Boolean(
    process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET && process.env.HOST
  );

  res.json({
    ok: true,
    service: 'juspit-b2b-quote-app',
    configured,
    sessionInstalled,
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

    storeSession(callback.session);
    logger.info('App installed', { shop: callback.session.shop });

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

app.listen(PORT, () => {
  logger.info(`Server listening on port ${PORT}`);
});
