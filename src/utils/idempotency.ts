interface IdempotencyEntry {
  draftOrderId: string;
  invoiceUrl: string;
  createdAt: number;
}

const TTL_MS = 2 * 60 * 1000;
const store = new Map<string, IdempotencyEntry>();

function cacheKey(shop: string, cartToken: string): string {
  return `${shop}:${cartToken}`;
}

export function getCachedDraft(
  shop: string,
  cartToken: string
): { draftOrderId: string; invoiceUrl: string } | null {
  const key = cacheKey(shop, cartToken);
  const entry = store.get(key);
  if (!entry) return null;

  if (Date.now() - entry.createdAt > TTL_MS) {
    store.delete(key);
    return null;
  }

  return { draftOrderId: entry.draftOrderId, invoiceUrl: entry.invoiceUrl };
}

export function setCachedDraft(
  shop: string,
  cartToken: string,
  draftOrderId: string,
  invoiceUrl: string
): void {
  const key = cacheKey(shop, cartToken);
  store.set(key, { draftOrderId, invoiceUrl, createdAt: Date.now() });
}

/** Limpia entradas expiradas (útil en tests). */
export function clearIdempotencyCache(): void {
  store.clear();
}
