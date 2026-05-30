import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Response } from 'express';

function resolvePublicDir(): string {
  const adjacent = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
  if (existsSync(join(adjacent, 'admin.html'))) return adjacent;
  return join(process.cwd(), 'public');
}

export function serveAdminPage(res: Response): void {
  const apiKey = process.env.SHOPIFY_API_KEY || '';
  const htmlPath = join(resolvePublicDir(), 'admin.html');
  const html = readFileSync(htmlPath, 'utf8').replace(/%SHOPIFY_API_KEY%/g, apiKey);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

export function serveSessionTokenBounce(res: Response): void {
  const apiKey = process.env.SHOPIFY_API_KEY || '';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta name="shopify-api-key" content="${apiKey}" />
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
</head>
</html>`);
}
