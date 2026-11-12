// Server-only environment. Never import this module from a client component.
// Values are validated at first use, so `next build` does not need them, and each route
// validates only the variables it needs: a missing ML token must not break the map tiles.
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ML_URL: z.url(),
  ML_API_TOKEN: z.string().min(1),
  SIMULATOR_URL: z.url(),
  SIM_CONTROL_TOKEN: z.string().min(1),
  TILES_PATH: z.string().min(1).default('/data/tiles/agrakhan.pmtiles'),
});
export type ServerEnv = z.infer<typeof envSchema>;
type EnvName = keyof ServerEnv;

function fail(error: z.ZodError): never {
  // Names only: values may be secrets.
  const names = [...new Set(error.issues.map((issue) => issue.path.join('.')))].join(', ');
  throw new Error(`Invalid or missing environment variables: ${names}`);
}

/** Validates and returns only the named variables. Throws a clear error naming the bad ones. */
export function env<K extends EnvName>(...names: K[]): Pick<ServerEnv, K> {
  const values: Record<string, unknown> = {};
  const invalid: string[] = [];
  for (const name of names) {
    const parsed = envSchema.shape[name].safeParse(process.env[name]);
    if (parsed.success) values[name] = parsed.data;
    else invalid.push(name);
  }
  if (invalid.length > 0) throw new Error(`Invalid or missing environment variables: ${invalid.join(', ')}`);
  return values as Pick<ServerEnv, K>;
}

let cached: ServerEnv | undefined;

/** The whole environment, validated once. */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) fail(parsed.error);
  cached = parsed.data;
  return cached;
}
