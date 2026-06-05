import { Session, type OnlineAccessInfo } from '@shopify/shopify-api';
import pg from 'pg';
import { logger } from './logger.js';

interface SessionRow {
  id: string;
  shop: string;
  state: string | null;
  is_online: boolean;
  scope: string | null;
  expires: Date | null;
  access_token: string | null;
  online_access_info: Record<string, unknown> | null;
}

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('Missing DATABASE_URL environment variable');
    }

    pool = new pg.Pool({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

function rowToSession(row: SessionRow): Session {
  return new Session({
    id: row.id,
    shop: row.shop,
    state: row.state ?? '',
    isOnline: row.is_online,
    scope: row.scope ?? undefined,
    expires: row.expires ?? undefined,
    accessToken: row.access_token ?? undefined,
    onlineAccessInfo: (row.online_access_info as OnlineAccessInfo | null) ?? undefined,
  });
}

export async function initSessionStorage(): Promise<void> {
  const db = getPool();

  await db.query(`
    CREATE TABLE IF NOT EXISTS shopify_sessions (
      id VARCHAR(255) PRIMARY KEY,
      shop VARCHAR(255) NOT NULL,
      state VARCHAR(255),
      is_online BOOLEAN DEFAULT FALSE,
      scope TEXT,
      expires TIMESTAMPTZ,
      access_token TEXT,
      online_access_info JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_shopify_sessions_shop ON shopify_sessions(shop)
  `);

  logger.info('Session storage initialized', { backend: 'postgresql' });
}

export async function storeSession(session: Session): Promise<void> {
  logger.info('Storing session', {
    sessionId: session.id,
    shop: session.shop,
    isOnline: session.isOnline,
    hasAccessToken: Boolean(session.accessToken),
  });

  try {
    await getPool().query(
      `INSERT INTO shopify_sessions
         (id, shop, state, is_online, scope, expires, access_token, online_access_info, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (id) DO UPDATE SET
         shop = EXCLUDED.shop,
         state = EXCLUDED.state,
         is_online = EXCLUDED.is_online,
         scope = EXCLUDED.scope,
         expires = EXCLUDED.expires,
         access_token = EXCLUDED.access_token,
         online_access_info = EXCLUDED.online_access_info,
         updated_at = NOW()`,
      [
        session.id,
        session.shop,
        session.state,
        session.isOnline,
        session.scope ?? null,
        session.expires ?? null,
        session.accessToken ?? null,
        session.onlineAccessInfo ? JSON.stringify(session.onlineAccessInfo) : null,
      ]
    );

    logger.info('Session stored successfully', {
      sessionId: session.id,
      shop: session.shop,
    });
  } catch (err) {
    logger.error('Session storage failed on store', {
      sessionId: session.id,
      shop: session.shop,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function loadSession(id: string): Promise<Session | null> {
  try {
    const result = await getPool().query<SessionRow>(
      'SELECT * FROM shopify_sessions WHERE id = $1',
      [id]
    );

    if (result.rowCount === 0) {
      logger.warn('Session not found', { sessionId: id });
      return null;
    }

    const session = rowToSession(result.rows[0]);
    logger.debug('Session loaded', { sessionId: id, shop: session.shop });
    return session;
  } catch (err) {
    logger.error('Session storage failed on load', {
      sessionId: id,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function deleteSessionsByShop(shop: string): Promise<void> {
  try {
    const result = await getPool().query(
      'DELETE FROM shopify_sessions WHERE shop = $1',
      [shop]
    );

    logger.info('Sessions deleted for shop', {
      shop,
      deletedCount: result.rowCount ?? 0,
    });
  } catch (err) {
    logger.error('Session storage failed on delete', {
      shop,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** Solo para tests: reinicia el pool singleton. */
export function resetSessionStorageForTests(): void {
  pool = null;
}
