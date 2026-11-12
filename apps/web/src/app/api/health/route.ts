import { getPool } from '@ecoshield/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  let db = false;
  try {
    await getPool().query('SELECT 1');
    db = true;
  } catch {
    db = false;
  }
  return Response.json(
    { status: db ? 'ok' : 'degraded', db },
    { status: db ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
