// Server-only environment. Never import this module from a client component.
// Values are validated once, at first use, so `next build` does not need them.
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

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Names only: values may be secrets.
    const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid or missing environment variables: ${names}`);
  }
  cached = parsed.data;
  return cached;
}
