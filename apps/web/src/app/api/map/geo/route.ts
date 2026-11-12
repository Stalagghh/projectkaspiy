import { loadMapGeo } from '@/features/map/server/geo';
import { jsonError, jsonOk } from '@/server/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  try {
    return jsonOk(await loadMapGeo());
  } catch (error) {
    console.error('[api/map/geo]', error);
    return jsonError(500, 'internal', 'Не удалось загрузить слои карты');
  }
}
