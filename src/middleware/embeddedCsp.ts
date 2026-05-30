import type { Request, Response, NextFunction } from 'express';

/** CSP mínimo para app embebida en Shopify Admin */
export function embeddedCsp(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors https://admin.shopify.com https://*.myshopify.com https://admin.shopify.io;"
  );
  next();
}
