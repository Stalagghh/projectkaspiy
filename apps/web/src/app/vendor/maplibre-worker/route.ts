// MapLibre GL 6 loads its worker from a URL next to its own module; inside a Next bundle that
// URL does not exist, so the client sets setWorkerUrl('/vendor/maplibre-worker') and we serve the
// self-contained worker module from the installed package. Same origin, no external request.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

let cached: Buffer | undefined;

export async function GET(): Promise<Response> {
  try {
    cached ??= await readFile(join(process.cwd(), 'node_modules', 'maplibre-gl', 'dist', 'maplibre-gl-worker.mjs'));
  } catch {
    return new Response('MapLibre worker not found', { status: 500 });
  }
  return new Response(new Uint8Array(cached), {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
