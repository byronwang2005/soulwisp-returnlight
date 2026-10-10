import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './index.js';

/** Apply committed SQL exactly once, inside one transaction guarded across processes. */
export async function migrateDatabase(): Promise<void> {
  const directory = fileURLToPath(new URL('../../migrations/', import.meta.url));
  const files = (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort();
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query('SELECT pg_advisory_xact_lock(732148201)');
    await connection.query('CREATE TABLE IF NOT EXISTS wangxu_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of files) {
      const source = await readFile(`${directory}/${name}`, 'utf8');
      const checksum = createHash('sha256').update(source).digest('hex');
      const previous = await connection.query<{ checksum: string }>('SELECT checksum FROM wangxu_migrations WHERE name=$1', [name]);
      if (previous.rows[0]) {
        if (previous.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await connection.query(source);
      await connection.query('INSERT INTO wangxu_migrations (name,checksum) VALUES ($1,$2)', [name, checksum]);
    }
    await connection.query('COMMIT');
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally { connection.release(); }
}
