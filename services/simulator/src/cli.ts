// Starts a scenario through the simulator control API and waits until every step is published.
// Usage: node services/simulator/src/cli.ts start night-poacher
// Env: SIMULATOR_URL (default http://127.0.0.1:8090), SIM_CONTROL_TOKEN (required).
import { scenarioNameSchema, scenarioRunSchema, type ScenarioRun } from '@ecoshield/contracts';

const [command, scenarioArg] = process.argv.slice(2);
const baseUrl = process.env.SIMULATOR_URL ?? 'http://127.0.0.1:8090';
const token = process.env.SIM_CONTROL_TOKEN;

function fail(message: string): never {
  console.error(`sim-cli: ${message}`);
  process.exit(1);
}

if (command !== 'start') fail('usage: cli.ts start night-poacher');
const scenario = scenarioNameSchema.safeParse(scenarioArg);
if (!scenario.success) fail(`unknown scenario "${scenarioArg ?? ''}"`);
if (!token) fail('SIM_CONTROL_TOKEN is not set');

const headers = { authorization: `Bearer ${token}` };

async function call(path: string, method: 'GET' | 'POST'): Promise<Response> {
  try {
    return await fetch(`${baseUrl}${path}`, { method, headers, signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    fail(`cannot reach the simulator at ${baseUrl}: ${(error as Error).message}`);
  }
}

async function readRun(res: Response): Promise<ScenarioRun> {
  const body: unknown = await res.json();
  if (!res.ok) fail(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  return scenarioRunSchema.parse(body);
}

const started = await readRun(await call(`/scenarios/${scenario.data}/start`, 'POST'));
console.log(`run ${started.runId} started at ${started.startedAt}`);
for (const step of started.steps) console.log(`  step ${step.step} -> ${step.deviceId} at +${step.offsetS}s (${step.clip})`);

const lastOffsetS = Math.max(...started.steps.map((s) => s.offsetS));
const deadline = Date.now() + (lastOffsetS + 30) * 1000;
let run = started;
while (run.steps.some((s) => s.publishedAt === null)) {
  if (Date.now() > deadline) fail('timed out waiting for the steps to be published');
  await new Promise((resolve) => setTimeout(resolve, 1000));
  run = await readRun(await call(`/runs/${started.runId}`, 'GET'));
}
for (const step of run.steps) console.log(`  published ${step.step}: ${step.publishedAt}`);
console.log('all steps published');
