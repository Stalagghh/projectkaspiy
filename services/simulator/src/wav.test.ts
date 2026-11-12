import assert from 'node:assert/strict';
import { test } from 'node:test';

import { simulatedReadings } from './telemetry.ts';
import { isWav, makeSineWav, parseWav } from './wav.ts';

test('parseWav reads the duration from the header', () => {
  const info = parseWav(makeSineWav(1.5));
  assert.equal(info.sampleRate, 16000);
  assert.equal(info.channels, 1);
  assert.equal(info.bitsPerSample, 16);
  assert.equal(info.durationS, 1.5);
});

test('parseWav skips extra chunks before data', () => {
  const wav = makeSineWav(0.5);
  const list = Buffer.alloc(8 + 4);
  list.write('LIST', 0, 'ascii');
  list.writeUInt32LE(4, 4);
  list.write('INFO', 8, 'ascii');
  const withList = Buffer.concat([wav.subarray(0, 36), list, wav.subarray(36)]);
  assert.equal(parseWav(withList).durationS, 0.5);
});

test('isWav rejects other formats', () => {
  assert.equal(isWav(Buffer.from('ID3\u0003 not a wav file')), false);
  assert.throws(() => parseWav(Buffer.from('RIFF0000WAVE')), /fmt/);
});

test('simulated readings are deterministic and within the expected ranges', () => {
  for (let tick = 0; tick < 400; tick++) {
    const r = simulatedReadings('wq-01', tick);
    assert.ok(r.water_temp_c >= 11 && r.water_temp_c <= 13);
    assert.ok(r.conductivity_us_cm >= 9000 && r.conductivity_us_cm <= 15000);
    assert.ok(r.turbidity_ntu >= 5 && r.turbidity_ntu <= 40);
  }
  assert.deepEqual(simulatedReadings('wq-02', 7), simulatedReadings('wq-02', 7));
  assert.notDeepEqual(simulatedReadings('wq-01', 7), simulatedReadings('wq-02', 7));
});
