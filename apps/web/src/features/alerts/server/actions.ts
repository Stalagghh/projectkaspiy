'use server';
// Inspector actions on an alert. Optimistic locking by `version`: a stale version or a
// status that does not allow the transition returns "conflict". The alerts_notify trigger
// then pushes the change to every open browser over SSE.
// No authentication in Milestone A (explicitly allowed by the plan for this milestone).
import { alertActionSchema, type ActionResult, type AlertDto } from '@ecoshield/contracts';
import { getPool } from '@ecoshield/db';

import { getAlert } from './queries';

async function failure(alertId: string): Promise<ActionResult<AlertDto>> {
  const { rowCount } = await getPool().query('SELECT 1 FROM alerts WHERE id = $1', [alertId]);
  return { ok: false, error: rowCount ? 'conflict' : 'not_found' };
}

async function success(alertId: string): Promise<ActionResult<AlertDto>> {
  const alert = await getAlert(alertId);
  return alert ? { ok: true, data: alert } : { ok: false, error: 'not_found' };
}

/** new -> acknowledged */
export async function acknowledgeAlert(input: unknown): Promise<ActionResult<AlertDto>> {
  const parsed = alertActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { alertId, version } = parsed.data;
  const { rowCount } = await getPool().query(
    `UPDATE alerts
        SET status = 'acknowledged', version = version + 1, updated_at = now(), acknowledged_at = now()
      WHERE id = $1 AND version = $2 AND status IN ('new')
      RETURNING id`,
    [alertId, version],
  );
  return rowCount ? success(alertId) : failure(alertId);
}

/** new | acknowledged -> resolved, with an optional note (max 500 characters). */
export async function resolveAlert(input: unknown): Promise<ActionResult<AlertDto>> {
  const parsed = alertActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { alertId, version, note } = parsed.data;
  const cleanNote = note?.trim() ? note.trim() : null;
  const { rowCount } = await getPool().query(
    `UPDATE alerts
        SET status = 'resolved', version = version + 1, updated_at = now(), resolved_at = now(),
            resolution_note = $3
      WHERE id = $1 AND version = $2 AND status IN ('new', 'acknowledged')
      RETURNING id`,
    [alertId, version, cleanNote],
  );
  return rowCount ? success(alertId) : failure(alertId);
}

/**
 * new | acknowledged -> false_positive: the inspector listened and disagrees with the model.
 * The alert and its clip stay in the database with this status; nothing is retrained from it yet.
 */
export async function markFalsePositive(input: unknown): Promise<ActionResult<AlertDto>> {
  const parsed = alertActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { alertId, version, note } = parsed.data;
  const cleanNote = note?.trim() ? note.trim() : null;
  const { rowCount } = await getPool().query(
    `UPDATE alerts
        SET status = 'false_positive', version = version + 1, updated_at = now(), resolved_at = now(),
            resolution_note = $3
      WHERE id = $1 AND version = $2 AND status IN ('new', 'acknowledged')
      RETURNING id`,
    [alertId, version, cleanNote],
  );
  return rowCount ? success(alertId) : failure(alertId);
}
