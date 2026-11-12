// Pure decision logic of the ingest worker (no I/O), so it can be unit-tested and explained.
import {
  METRICS,
  PRIORITY_POINTS,
  type AlertKind,
  type AudioLabel,
  type MetricName,
  type PriorityReason,
  type Severity,
} from '@ecoshield/contracts';

export type DeviceCursor = { bootId: number; seq: number };

/**
 * Replay protection: a message is new only if (bootId, seq) is strictly greater than the stored pair
 * (lexicographic order). The SQL UPDATE in pipeline.ts applies the same rule atomically.
 */
export function isNewer(stored: DeviceCursor | null, incoming: DeviceCursor): boolean {
  if (stored === null) return true;
  if (incoming.bootId !== stored.bootId) return incoming.bootId > stored.bootId;
  return incoming.seq > stored.seq;
}

/** A reading outside the physically plausible range of its metric is kept but marked "suspect". */
export function qualityOf(metric: MetricName, value: number): 'ok' | 'suspect' {
  const range = METRICS[metric];
  return value < range.validMin || value > range.validMax ? 'suspect' : 'ok';
}

export type AlertInput = {
  label: AudioLabel;
  confidence: number;
  /** The device is inside a zone of kind "no_entry". */
  inNoEntryZone: boolean;
  /** Sun more than 6° below the horizon at the device and event time. */
  isDark: boolean;
  /** A gunshot that has an open boat alert nearby (CORRELATION window and radius). */
  correlatedWithBoat: boolean;
};

export type AlertDecision = {
  kind: AlertKind;
  severity: Severity;
  priority: number;
  reasons: PriorityReason[];
};

/** Turns a classification into an alert (or none for background). Priority = sum of the reasons. */
export function decideAlert(input: AlertInput): AlertDecision | null {
  if (input.label === 'background') return null;
  let kind: AlertKind;
  let severity: Severity;
  if (input.label === 'gunshot') {
    kind = 'gunshot';
    severity = 'critical';
  } else if (input.inNoEntryZone) {
    kind = 'boat_in_no_entry_zone';
    severity = 'warning';
  } else {
    kind = 'boat_detected';
    severity = 'info';
  }
  const reasons: PriorityReason[] = [
    { code: 'severity', points: PRIORITY_POINTS.severity[severity] },
    { code: 'confidence', points: Math.round(input.confidence * PRIORITY_POINTS.confidenceWeight) },
  ];
  if (input.inNoEntryZone) reasons.push({ code: 'no_entry_zone', points: PRIORITY_POINTS.noEntryZone });
  if (input.isDark) reasons.push({ code: 'darkness', points: PRIORITY_POINTS.darkness });
  if (input.label === 'gunshot' && input.correlatedWithBoat) {
    reasons.push({ code: 'correlated_gunshot', points: PRIORITY_POINTS.correlatedGunshot });
  }
  return { kind, severity, priority: reasons.reduce((sum, r) => sum + r.points, 0), reasons };
}

/** Alert raised at once when the ML service cannot classify a clip (degraded mode). */
export function unclassifiedAlert(): AlertDecision {
  const points = PRIORITY_POINTS.severity.warning;
  return {
    kind: 'acoustic_unclassified',
    severity: 'warning',
    priority: points,
    reasons: [{ code: 'severity', points }],
  };
}

/** Checks an audio payload before it is stored: size, RIFF/WAVE magic bytes, then the checksum. */
export function checkClip(bytes: Buffer, maxBytes: number): string | null {
  if (bytes.length === 0) return 'empty clip';
  if (bytes.length > maxBytes) return `clip larger than ${maxBytes} bytes`;
  const isWav =
    bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE';
  return isWav ? null : 'not a RIFF/WAVE file';
}
