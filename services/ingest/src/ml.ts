// HTTP client of the ML service. Every response is validated with the shared zod contract.
import {
  classifyResponseSchema,
  forecastResponseSchema,
  type ClassifyResponse,
  type ForecastRequest,
  type ForecastResponse,
} from '@ecoshield/contracts';

export type MlConfig = { url: string; token: string };

const CLASSIFY_TIMEOUT_MS = 15_000;
const FORECAST_TIMEOUT_MS = 30_000;

/** The ML service refused the clip itself (too large, unknown type, cannot decode): retrying will not help. */
export class ClipRejectedError extends Error {}

export async function classifyAudio(ml: MlConfig, audio: Buffer): Promise<ClassifyResponse> {
  const res = await fetch(`${ml.url}/v1/audio/classify?topK=5&spectrogram=true`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ml.token}`, 'content-type': 'application/octet-stream' },
    body: new Uint8Array(audio),
    signal: AbortSignal.timeout(CLASSIFY_TIMEOUT_MS),
  });
  if (res.status === 413 || res.status === 415 || res.status === 422) {
    throw new ClipRejectedError(`ML rejected the clip with HTTP ${res.status}`);
  }
  if (!res.ok) throw new Error(`ML classify returned HTTP ${res.status}`);
  return classifyResponseSchema.parse(await res.json());
}

export async function forecastSeal(ml: MlConfig, request: ForecastRequest): Promise<ForecastResponse> {
  const res = await fetch(`${ml.url}/v1/forecast/seal`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ml.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(FORECAST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ML forecast returned HTTP ${res.status}`);
  return forecastResponseSchema.parse(await res.json());
}
