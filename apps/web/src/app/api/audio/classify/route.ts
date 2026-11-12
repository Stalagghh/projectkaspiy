// POST /api/audio/classify
// Body: the raw audio file (Content-Type: application/octet-stream), not multipart, so the
// size can be counted while streaming and the bytes go to the ML service unchanged.
//   200 ClassifyResponse (packages/contracts/src/ml.ts), validated with classifyResponseSchema
//   400 {error: "empty_body"}           415 {error: "unsupported_type"} (magic bytes)
//   403 {error: "forbidden_origin"}     422 {error: "undecodable"} (or longer than 60 s)
//   413 {error: "too_large"} (> 10 MB)  502 {error: "ml_error" | "ml_invalid_response"}
//   503 {error: "ml_unavailable" | "ml_not_configured"}  504 {error: "ml_timeout"}
// Analysis only: the file is not stored and no alert is created.
import type { NextRequest } from 'next/server';

import {
  MAX_AUDIO_BYTES,
  classifyAudio,
  readBodyWithLimit,
} from '../../../../features/audio/server/classify';

/** Browsers send Origin on cross-site POSTs; reject those (no session yet, see PROGRESS.md). */
function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isSameOrigin(request)) return Response.json({ error: 'forbidden_origin' }, { status: 403 });

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_AUDIO_BYTES) return Response.json({ error: 'too_large' }, { status: 413 });

  const body = await readBodyWithLimit(request.body, MAX_AUDIO_BYTES);
  if (body === 'too_large') return Response.json({ error: 'too_large' }, { status: 413 });

  const result = await classifyAudio(body);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result.data, { headers: { 'Cache-Control': 'no-store' } });
}
