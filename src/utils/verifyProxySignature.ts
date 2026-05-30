import crypto from 'node:crypto';

const MAX_TIMESTAMP_AGE_SEC = 300;

export interface ProxyQueryParams {
  signature?: string;
  shop?: string;
  logged_in_customer_id?: string;
  path_prefix?: string;
  timestamp?: string;
  [key: string]: string | undefined;
}

export type ProxyVerificationResult =
  | { valid: true; shop: string; loggedInCustomerId: string | null }
  | { valid: false; reason: 'missing_signature' | 'invalid_signature' | 'expired_timestamp' | 'missing_shop' };

/**
 * Verifica la firma HMAC de una petición App Proxy de Shopify.
 * @see https://shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies
 */
export function verifyProxySignature(
  query: ProxyQueryParams,
  apiSecret: string
): ProxyVerificationResult {
  const { signature, shop, timestamp } = query;

  if (!signature) {
    return { valid: false, reason: 'missing_signature' };
  }

  if (!shop) {
    return { valid: false, reason: 'missing_shop' };
  }

  if (timestamp) {
    const age = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (Number.isNaN(age) || age > MAX_TIMESTAMP_AGE_SEC) {
      return { valid: false, reason: 'expired_timestamp' };
    }
  }

  const sorted = Object.keys(query)
    .filter((key) => key !== 'signature' && query[key] !== undefined)
    .sort()
    .map((key) => `${key}=${query[key]}`)
    .join('');

  const digest = crypto.createHmac('sha256', apiSecret).update(sorted).digest('hex');

  if (signature.length !== digest.length) {
    return { valid: false, reason: 'invalid_signature' };
  }

  const signatureBuffer = Buffer.from(signature, 'utf8');
  const digestBuffer = Buffer.from(digest, 'utf8');

  if (!crypto.timingSafeEqual(signatureBuffer, digestBuffer)) {
    return { valid: false, reason: 'invalid_signature' };
  }

  const loggedInCustomerId = query.logged_in_customer_id?.trim() || null;

  return { valid: true, shop, loggedInCustomerId };
}
