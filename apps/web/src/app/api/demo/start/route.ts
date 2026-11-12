// Starts the scripted "night poacher" scenario in the simulator (simulated data, labelled in the UI).
import { scenarioRunSchema } from '@ecoshield/contracts';

import { serverEnv } from '@/server/env';
import { jsonError, jsonOk } from '@/server/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(): Promise<Response> {
  let env;
  try {
    env = serverEnv();
  } catch (error) {
    console.error('[api/demo/start]', error);
    return jsonError(500, 'config', 'Симулятор не настроен на сервере');
  }
  let response: Response;
  try {
    response = await fetch(`${env.SIMULATOR_URL}/scenarios/night-poacher/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.SIM_CONTROL_TOKEN}` },
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
  } catch (error) {
    console.error('[api/demo/start] simulator unreachable', error);
    return jsonError(502, 'simulator_unreachable', 'Симулятор недоступен');
  }
  if (!response.ok) {
    return jsonError(502, 'simulator_error', `Симулятор ответил кодом ${response.status}`);
  }
  const run = scenarioRunSchema.safeParse(await response.json().catch(() => null));
  if (!run.success) {
    console.error('[api/demo/start] unexpected simulator response', run.error.issues);
    return jsonError(502, 'simulator_invalid', 'Неожиданный ответ симулятора');
  }
  return jsonOk(run.data);
}
