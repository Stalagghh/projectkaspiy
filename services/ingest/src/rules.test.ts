import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkClip, decideAlert, isNewer, qualityOf, unclassifiedAlert } from './rules.ts';
import { dailyMeans, forecastDates } from './forecast-job.ts';

test('replay: (bootId, seq) must be strictly greater than the stored pair', () => {
  assert.equal(isNewer(null, { bootId: 1, seq: 0 }), true);
  assert.equal(isNewer({ bootId: 5, seq: 10 }, { bootId: 5, seq: 11 }), true);
  assert.equal(isNewer({ bootId: 5, seq: 10 }, { bootId: 5, seq: 10 }), false, 'same message again');
  assert.equal(isNewer({ bootId: 5, seq: 10 }, { bootId: 5, seq: 9 }), false, 'older message');
  assert.equal(isNewer({ bootId: 5, seq: 10 }, { bootId: 6, seq: 0 }), true, 'device rebooted');
  assert.equal(isNewer({ bootId: 5, seq: 10 }, { bootId: 4, seq: 99 }), false, 'previous boot');
});

test('quality: values outside METRICS ranges are suspect', () => {
  assert.equal(qualityOf('water_temp_c', 12), 'ok');
  assert.equal(qualityOf('water_temp_c', -2), 'ok');
  assert.equal(qualityOf('water_temp_c', 41), 'suspect');
  assert.equal(qualityOf('conductivity_us_cm', -1), 'suspect');
  assert.equal(qualityOf('conductivity_us_cm', 60000), 'ok');
  assert.equal(qualityOf('turbidity_ntu', 4000.1), 'suspect');
});

test('alert rules: background raises nothing', () => {
  assert.equal(
    decideAlert({ label: 'background', confidence: 0.9, inNoEntryZone: true, isDark: true, correlatedWithBoat: false }),
    null,
  );
});

test('alert rules: boat outside a no-entry zone is info', () => {
  const d = decideAlert({ label: 'boat_engine', confidence: 0.5, inNoEntryZone: false, isDark: false, correlatedWithBoat: false });
  assert.deepEqual(d, {
    kind: 'boat_detected',
    severity: 'info',
    priority: 20,
    reasons: [
      { code: 'severity', points: 10 },
      { code: 'confidence', points: 10 },
    ],
  });
});

test('alert rules: boat in a no-entry zone at night is a warning with zone and darkness points', () => {
  const d = decideAlert({ label: 'boat_engine', confidence: 0.82, inNoEntryZone: true, isDark: true, correlatedWithBoat: false });
  assert.equal(d?.kind, 'boat_in_no_entry_zone');
  assert.equal(d?.severity, 'warning');
  assert.equal(d?.priority, 50 + 16 + 10 + 10);
  assert.deepEqual(
    d?.reasons.map((r) => r.code),
    ['severity', 'confidence', 'no_entry_zone', 'darkness'],
  );
});

test('alert rules: correlated gunshot is critical with the correlation bonus', () => {
  const d = decideAlert({ label: 'gunshot', confidence: 0.91, inNoEntryZone: true, isDark: true, correlatedWithBoat: true });
  assert.equal(d?.kind, 'gunshot');
  assert.equal(d?.severity, 'critical');
  assert.equal(d?.priority, 100 + 18 + 10 + 10 + 20);
  assert.ok(d?.reasons.some((r) => r.code === 'correlated_gunshot' && r.points === 20));
});

test('alert rules: correlation bonus only applies to gunshots', () => {
  const d = decideAlert({ label: 'boat_engine', confidence: 1, inNoEntryZone: false, isDark: false, correlatedWithBoat: true });
  assert.equal(d?.reasons.some((r) => r.code === 'correlated_gunshot'), false);
});

test('degraded alert: unclassified acoustic event is a warning with severity points only', () => {
  assert.deepEqual(unclassifiedAlert(), {
    kind: 'acoustic_unclassified',
    severity: 'warning',
    priority: 50,
    reasons: [{ code: 'severity', points: 50 }],
  });
});

test('clip check: size limit and RIFF/WAVE magic bytes', () => {
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')]);
  assert.equal(checkClip(wav, 100), null);
  assert.match(checkClip(wav, 10) ?? '', /larger/);
  assert.match(checkClip(Buffer.from('OggS0000000000'), 100) ?? '', /RIFF/);
});

test('forecast: dates start today in Moscow time', () => {
  // 22:30 UTC on 12 Nov is already 13 Nov in Moscow (UTC+3).
  assert.deepEqual(forecastDates(new Date('2026-11-12T22:30:00Z'), 2), ['2026-11-13', '2026-11-14']);
  assert.equal(forecastDates(new Date('2026-11-12T10:00:00Z'), 7).length, 7);
});

test('forecast: daily means of hourly values ignore nulls', () => {
  const times = ['2026-11-12T00:00', '2026-11-12T01:00', '2026-11-13T00:00'];
  assert.deepEqual(dailyMeans(times, [2, 4, null], ['2026-11-12']), [3]);
  assert.throws(() => dailyMeans(times, [2, 4, null], ['2026-11-13']), /no hourly values/);
});
