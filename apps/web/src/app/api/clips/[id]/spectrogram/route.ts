import { getPool } from '@ecoshield/db';

import { jsonError, uuidParam } from '@/server/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = uuidParam.safeParse((await ctx.params).id);
  if (!id.success) return jsonError(400, 'invalid', 'id должен быть UUID');
  try {
    const { rows } = await getPool().query<{ png: Buffer | null }>(
      'SELECT spectrogram_png AS png FROM audio_clips WHERE id = $1',
      [id.data],
    );
    const png = rows[0]?.png;
    if (!png) return jsonError(404, 'not_found');
    return new Response(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(png.byteLength),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error('[api/clips/:id/spectrogram]', error);
    return jsonError(500, 'internal');
  }
}
