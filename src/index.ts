import 'dotenv/config';
import express from 'express';
import { handleCreateB2bDraftOrder } from './routes/create-b2b-draft-order.js';
import { getShopifyAuth, storeSession } from './utils/shopifyAdmin.js';
import { logger } from './utils/logger.js';

const PORT = Number(process.env.PORT || 3000);
const app = express();

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'juspit-b2b-quote-app' });
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
