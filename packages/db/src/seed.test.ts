import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkCollection } from './seed.ts';

const spec = {
  file: 'devices.geojson',
  geometry: ['Point'],
  props: { id: 'string', kind: 'kind', name_ru: 'string', simulated: 'boolean' },
  kinds: ['acoustic_buoy', 'water_station'],
} as const;

const device = (props: Record<string, unknown>) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [47.7, 43.9] },
  properties: props,
});

test('checkCollection accepts a valid collection', () => {
  const features = checkCollection(
    { type: 'FeatureCollection', features: [device({ id: 'wq-01', kind: 'water_station', name_ru: 'Станция', simulated: true })] },
    spec,
  );
  assert.equal(features.length, 1);
});

test('checkCollection names the file and the bad property', () => {
  assert.throws(
    () =>
      checkCollection(
        { type: 'FeatureCollection', features: [device({ id: 'wq-01', kind: 'satellite', name_ru: 'x', simulated: true })] },
        spec,
      ),
    /devices\.geojson .*features\[0\]\.properties\.kind/,
  );
  assert.throws(() => checkCollection({ type: 'Feature' }, spec), /FeatureCollection/);
});
