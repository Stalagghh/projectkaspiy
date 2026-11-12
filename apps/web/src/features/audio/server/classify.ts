// Inspector audio upload: size and type checks, then classification by the ML service.
// Nothing is stored and no alert is created: the result is only shown to the inspector.
import { type ClassifyResponse, classifyResponseSchema } from '@ecoshield/contracts';

import { readMlEnv } from './env';

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const ML_TIMEOUT_MS = 20_000;

/** Short machine-readable error codes; the page maps them to Russian messages. */
export type AudioErrorCode =
  | 'empty_body'
  | 'too_large'
  | 'unsupported_type'
  | 'undecodable'
  | 'ml_timeout'
  | 'ml_unavailable'
  | 'ml_not_configured'
  | 'ml_error'
  | 'ml_invalid_response';

export type ClassifyResult =
  | { ok: true; data: ClassifyResponse }
  | { ok: false; status: number; error: AudioErrorCode };

const fail = (status: number, error: AudioErrorCode): ClassifyResult => ({ ok: false, status, error });

/**
 * Reads the raw request body while counting bytes, and stops as soon as the limit is passed,
 * so a client that lies about Content-Length cannot make the server buffer more than 10 MB.
 */
export async function readBodyWithLimit(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array<ArrayBuffer> | 'too_large'> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return 'too_large';
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

const ascii = (bytes: Uint8Array, start: number, text: string): boolean =>
  [...text].every((char, i) => bytes[start + i] === char.charCodeAt(0));

/** Audio container by magic bytes: WAV (RIFF....WAVE), FLAC, Ogg, MP3 (ID3 tag or frame sync). */
export function sniffAudioType(bytes: Uint8Array): 'wav' | 'flac' | 'ogg' | 'mp3' | null {
  if (bytes.length >= 12 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WAVE')) return 'wav';
  if (ascii(bytes, 0, 'fLaC')) return 'flac';
  if (ascii(bytes, 0, 'OggS')) return 'ogg';
  if (ascii(bytes, 0, 'ID3')) return 'mp3';
  const [b0, b1] = [bytes[0], bytes[1]];
  if (b0 === 0xff && b1 !== undefined && (b1 & 0xe0) === 0xe0) return 'mp3';
  return null;
}

/** Maps an ML service error status to the status and code returned to the browser. */
function mlError(status: number): ClassifyResult {
  switch (status) {
    case 413:
      return fail(413, 'too_large');
    case 415:
      return fail(415, 'unsupported_type');
    case 422:
      return fail(422, 'undecodable');
    case 504:
      return fail(504, 'ml_timeout');
    default:
      // 401 means our token is wrong: a server problem, not the inspector's.
      return fail(502, 'ml_error');
  }
}

export async function classifyAudio(bytes: Uint8Array<ArrayBuffer>): Promise<ClassifyResult> {
  if (bytes.byteLength === 0) return fail(400, 'empty_body');
  if (bytes.byteLength > MAX_AUDIO_BYTES) return fail(413, 'too_large');
  if (!sniffAudioType(bytes)) return fail(415, 'unsupported_type');

  const env = readMlEnv();
  if (!env) return fail(503, 'ml_not_configured');

  let response: Response;
  try {
    response = await fetch(`${env.ML_URL}/v1/audio/classify?topK=5&spectrogram=true`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.ML_API_TOKEN}`,
        'Content-Type': 'application/octet-stream',
      },
      body: bytes,
      signal: AbortSignal.timeout(ML_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') return fail(504, 'ml_timeout');
    console.error('[audio] ML service is unreachable', error);
    return fail(503, 'ml_unavailable');
  }

  if (!response.ok) {
    console.warn(`[audio] ML service answered ${response.status}`);
    await response.body?.cancel();
    return mlError(response.status);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return fail(502, 'ml_invalid_response');
  }
  const parsed = classifyResponseSchema.safeParse(json);
  if (!parsed.success) {
    console.error('[audio] ML response does not match the contract', parsed.error.issues.slice(0, 5));
    return fail(502, 'ml_invalid_response');
  }
  return { ok: true, data: parsed.data };
}
