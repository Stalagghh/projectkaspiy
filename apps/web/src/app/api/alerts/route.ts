import { listAlerts } from '@/features/alerts/server/queries';
import { jsonError, jsonOk } from '@/server/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  try {
    return jsonOk({ alerts: await listAlerts() });
  } catch (error) {
    console.error('[api/alerts]', error);
    return jsonError(500, 'internal', 'Не удалось загрузить тревоги');
  }
}
