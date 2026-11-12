// Removes everything a demo scenario created: simulated alerts, their detections and clips.
// Readings and the seed geography are kept.
// Run: DATABASE_URL=... node packages/db/src/demo-reset.ts
import { fileURLToPath } from 'node:url';

import { closePool, getPool } from './client.ts';

export type ResetCounts = { alerts: number; detections: number; clips: number };

export async function resetDemo(): Promise<ResetCounts> {
  const db = await getPool().connect();
  try {
    await db.query('BEGIN');
    // Order matters only for the counts: foreign keys to clips and detections are ON DELETE SET NULL/CASCADE.
    const alerts = await db.query('DELETE FROM alerts WHERE is_simulated');
    const detections = await db.query(
      'DELETE FROM detections WHERE clip_id IN (SELECT id FROM audio_clips WHERE is_simulated)',
    );
    const clips = await db.query('DELETE FROM audio_clips WHERE is_simulated');
    await db.query('COMMIT');
    return { alerts: alerts.rowCount ?? 0, detections: detections.rowCount ?? 0, clips: clips.rowCount ?? 0 };
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    db.release();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  resetDemo()
    .then((c) => console.log(`demo-reset: deleted ${c.alerts} alerts, ${c.detections} detections, ${c.clips} clips`))
    .catch((error: unknown) => {
      console.error(`demo-reset: ${(error as Error).message}`);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
