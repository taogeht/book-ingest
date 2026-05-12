import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Lazy pool initialization. Next 16 collects route data at build time, which
// instantiates every route module — and we don't want that to require
// DATABASE_URL. We create the pool on first query.

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _pool: Pool | null = null;

function init() {
  if (_db) return _db;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  _pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  _pool.on('error', (err) => console.error('[db-pool]', err));
  _db = drizzle(_pool, { schema });
  return _db;
}

// A Proxy so existing `db.select()` / `db.query.*` call-sites continue to work
// without an explicit init() call.
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_, prop) {
    const real = init() as any;
    const value = real[prop];
    return typeof value === 'function' ? value.bind(real) : value;
  },
});

export * from './schema';
