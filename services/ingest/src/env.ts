// Environment of the ingest worker, validated once at startup.
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  MQTT_URL: z.string().min(1),
  ML_URL: z.string().url(),
  ML_API_TOKEN: z.string().min(1),
  INGEST_HEALTH_PORT: z.coerce.number().int().positive().default(8081),
  /** Delay before the first forecast run, then every 6 hours. */
  FORECAST_FIRST_DELAY_MS: z.coerce.number().int().nonnegative().default(15_000),
});
export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    console.error(`ingest: invalid or missing environment variables: ${fields}`);
    process.exit(1);
  }
  return { ...parsed.data, ML_URL: parsed.data.ML_URL.replace(/\/+$/, '') };
}
