import 'dotenv/config';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://localhost:55432/wangxu',
  max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30_000,
});
// Idle connection loss must not throw an unhandled event and terminate active games.
pool.on('error', error => console.error('[database] idle connection failed:', error.message));
export const db = drizzle(pool, { schema });
export { schema };
export { migrateDatabase } from './migrate.js';
