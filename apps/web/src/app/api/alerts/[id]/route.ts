import { getAlert } from '@/features/alerts/server/queries';
import { jsonError, jsonOk, uuidParam } from '@/server/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = uuidParam.safeParse((await ctx.params).id);
  if (!id.success) return jsonError(400, 'invalid', 'id должен быть UUID');
  try {
    const alert = await getAlert(id.data);
    return alert ? jsonOk(alert) : jsonError(404, 'not_found');
  } catch (error) {
    console.error('[api/alerts/:id]', error);
    return jsonError(500, 'internal');
  }
}
