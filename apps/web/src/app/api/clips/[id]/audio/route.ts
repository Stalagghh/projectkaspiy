import { getPool } from '@ecoshield/db';

import { rangeResponse } from '@/server/http-range';
import { jsonError, uuidParam } from '@/server/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED_MIME = new Set(['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mpeg', 'audio/flac', 'audio/ogg']);

// Clips are small (<= 10 MB, <= 60 s), so they are read whole and sliced in memory.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = uuidParam.safeParse((await ctx.params).id);
  if (!id.success) return jsonError(400, 'invalid', 'id должен быть UUID');
  try {
    const { rows } = await getPool().query<{ mime: string; audio: Buffer }>(
      'SELECT mime, audio FROM audio_clips WHERE id = $1',
      [id.data],
    );
    const row = rows[0];
    if (!row) return jsonError(404, 'not_found');
    const mime = ALLOWED_MIME.has(row.mime) ? row.mime : 'application/octet-stream';
    return rangeResponse(new Uint8Array(row.audio), mime, request.headers.get('range'));
  } catch (error) {
    console.error('[api/clips/:id/audio]', error);
    return jsonError(500, 'internal');
  }
}
