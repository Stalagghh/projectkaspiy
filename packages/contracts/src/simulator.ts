// Control API of the scenario simulator (services/simulator), reachable only inside
// the Docker network. Requests need "Authorization: Bearer <SIM_CONTROL_TOKEN>".
//   GET  /healthz                    -> { status: "ok" }
//   POST /scenarios/:name/start      -> 202 ScenarioRun
//   GET  /runs/:runId                -> ScenarioRun (publishedAt filled in as steps go out)
import { z } from 'zod';

export const SCENARIOS = ['night-poacher'] as const;
export const scenarioNameSchema = z.enum(SCENARIOS);

export const scenarioRunSchema = z.object({
  runId: z.uuid(),
  scenario: scenarioNameSchema,
  startedAt: z.string(),
  steps: z.array(
    z.object({
      step: z.string(),
      deviceId: z.string(),
      kind: z.literal('audio'),
      clip: z.string(),
      offsetS: z.number().nonnegative(),
      /** Set when the message was published to MQTT. */
      publishedAt: z.string().nullable(),
    }),
  ),
});
export type ScenarioRun = z.infer<typeof scenarioRunSchema>;

/** The scripted "night poacher" story: a motorboat in the no-entry zone, then a gunshot. */
export const NIGHT_POACHER_STEPS = [
  { step: 'boat-engine', deviceId: 'buoy-02', kind: 'audio', clip: 'boat_engine.wav', offsetS: 3 },
  { step: 'gunshot', deviceId: 'buoy-02', kind: 'audio', clip: 'gunshot.wav', offsetS: 15 },
] as const;
