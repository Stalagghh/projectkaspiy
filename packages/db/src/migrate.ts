// Applies packages/db/migrations/*.sql in name order, each once, inside a transaction.
// Run: node packages/db/src/migrate.ts  (needs DATABASE_URL)
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { closePool, getPool } from './client.ts';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrate(): Promise<string[]> {
  const pool = getPool();
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const done = new Set(
    (await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  );
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      applied.push(file);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`migration ${file} failed: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate()
    .then((applied) => console.log(`migrate: ${applied.length ? applied.join(', ') : 'up to date'}`))
    .catch((error: unknown) => {
      console.error(`migrate: ${(error as Error).message}`);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
