// ML service settings for the audio route. Read on each request so that a missing variable
// gives a clear 503 instead of crashing the server at start-up.
import { z } from 'zod';

const mlEnvSchema = z.object({
  ML_URL: z.url(),
  ML_API_TOKEN: z.string().min(1),
});
export type MlEnv = z.infer<typeof mlEnvSchema>;

export function readMlEnv(): MlEnv | null {
  const parsed = mlEnvSchema.safeParse({
    ML_URL: process.env.ML_URL,
    ML_API_TOKEN: process.env.ML_API_TOKEN,
  });
  if (!parsed.success) {
    console.error('[audio] ML_URL or ML_API_TOKEN is missing or invalid');
    return null;
  }
  return { ...parsed.data, ML_URL: parsed.data.ML_URL.replace(/\/+$/, '') };
}
