import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isDark, solarElevationDeg } from './sun.ts';

const near = (actual: number, expected: number, tolerance: number): void =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected} ± ${tolerance}, got ${actual}`);

test('summer solstice noon at Greenwich: elevation is 90 - latitude + 23.44', () => {
  // Solar noon at Greenwich on 2024-06-21 is about 12:02 UTC; declination +23.44°.
  near(solarElevationDeg(new Date('2024-06-21T12:02:00Z'), 51.4769, 0), 90 - 51.4769 + 23.44, 0.3);
});

test('summer solstice midnight at Greenwich: sun well below civil twilight', () => {
  near(solarElevationDeg(new Date('2024-06-21T00:02:00Z'), 51.4769, 0), -(90 - 51.4769 - 23.44), 0.3);
});

test('Agrakhan, 12 November 2026: about 28° at local solar noon, dark in the evening', () => {
  // Local solar noon at 47.75°E is near 08:35 UTC in mid-November (equation of time about +16 min).
  // Declination on 12 November is about -17.8°, so the noon elevation is about 90 - 43.95 - 17.8 = 28.2°.
  near(solarElevationDeg(new Date('2026-11-12T08:35:00Z'), 43.95, 47.75), 28.2, 0.5);
  assert.equal(isDark(new Date('2026-11-12T08:35:00Z'), 43.95, 47.75), false);
  // 21:00 Moscow time (18:00 UTC) is well after civil dusk.
  assert.equal(isDark(new Date('2026-11-12T18:00:00Z'), 43.95, 47.75), true);
});
