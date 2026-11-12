// One shared connection pool per process. All queries must be parameterized ($1, $2, ...).
import pg from 'pg';

let pool: pg.Pool | undefined;

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return url;
}

export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: databaseUrl(), max: 10 });
  return pool;
}

/** A dedicated client for LISTEN; the caller owns it and must reconnect if it ends. */
export async function connectListener(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  return client;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
