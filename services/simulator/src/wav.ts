// Minimal WAV (RIFF) header reader: enough to compute a clip duration without decoding audio.

export type WavInfo = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
  durationS: number;
};

/** True when the buffer starts with "RIFF....WAVE". */
export function isWav(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WAVE'
  );
}

/** Walks the RIFF chunks, reads "fmt " and the size of "data". Throws on a malformed file. */
export function parseWav(buf: Buffer): WavInfo {
  if (!isWav(buf)) throw new Error('not a RIFF/WAVE file');
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let byteRate = 0;
  let dataBytes = -1;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > buf.length) throw new Error('fmt chunk is too short');
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      byteRate = buf.readUInt32LE(body + 8);
      bitsPerSample = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      // Some writers leave the size at 0xFFFFFFFF while streaming: use the bytes actually present.
      dataBytes = Math.min(size, buf.length - body);
      break;
    }
    offset = body + size + (size % 2); // chunks are padded to an even size
  }
  if (byteRate <= 0 || sampleRate <= 0) throw new Error('missing or invalid fmt chunk');
  if (dataBytes < 0) throw new Error('missing data chunk');
  return { sampleRate, channels, bitsPerSample, dataBytes, durationS: dataBytes / byteRate };
}

/** Builds a 16-bit PCM mono WAV with a sine tone. Used by tests and local smoke checks only. */
export function makeSineWav(seconds: number, sampleRate = 16000, freqHz = 440): Buffer {
  const samples = Math.round(seconds * sampleRate);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * freqHz * i) / sampleRate) * 8000);
    buf.writeInt16LE(v, 44 + i * 2);
  }
  return buf;
}
