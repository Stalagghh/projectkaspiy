// Offline basemap: serves exactly one PMTiles archive with HTTP Range support.
// The folder is a dynamic segment because "*.pmtiles" paths are git-ignored; only the
// allow-listed file name is accepted, so no path from the URL ever reaches the filesystem.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

import { env } from '@/server/env';
import { parseRange } from '@/server/http-range';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED_FILE = 'agrakhan.pmtiles';

export async function GET(request: Request, ctx: { params: Promise<{ file: string }> }): Promise<Response> {
  const { file } = await ctx.params;
  if (file !== ALLOWED_FILE) return new Response('Not found', { status: 404 });

  let path: string;
  try {
    path = env('TILES_PATH').TILES_PATH;
  } catch (error) {
    console.error('[tiles]', error);
    return new Response('Tiles not configured', { status: 500 });
  }
  let size: number;
  let mtime: Date;
  try {
    const info = await stat(path);
    size = info.size;
    mtime = info.mtime;
  } catch {
    return new Response('Tiles not available', { status: 404 });
  }

  const common = {
    'Accept-Ranges': 'bytes',
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'public, max-age=3600',
    'Last-Modified': mtime.toUTCString(),
  };
  const range = parseRange(request.headers.get('range'), size);
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...common, 'Content-Range': `bytes */${size}` } });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      ...common,
      'Content-Length': String(end - start + 1),
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    },
  });
}
