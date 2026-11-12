// Deterministic simulated water-quality readings: a slow sine per device plus small seeded noise.
// The same device and sequence number always give the same values (reproducible demo).

export const WATER_STATIONS = ['wq-01', 'wq-02', 'wq-03'] as const;

/** Mulberry32: tiny seeded pseudo-random generator, returns numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const round = (v: number, digits: number): number => Number(v.toFixed(digits));

/** One period of the slow sine is 360 ticks (30 minutes at one reading every 5 s). */
const PERIOD_TICKS = 360;

export type SimReadings = { water_temp_c: number; conductivity_us_cm: number; turbidity_ntu: number };

export function simulatedReadings(deviceId: string, tick: number): SimReadings {
  const deviceRandom = mulberry32(hashString(deviceId));
  const phase = deviceRandom() * 2 * Math.PI; // each device has its own phase and offsets
  const tempOffset = (deviceRandom() - 0.5) * 0.6;
  const condOffset = (deviceRandom() - 0.5) * 1500;
  const noise = mulberry32(hashString(deviceId) ^ tick); // small noise, still deterministic
  const s = Math.sin((2 * Math.PI * tick) / PERIOD_TICKS + phase);
  return {
    water_temp_c: round(clamp(12 + tempOffset + 0.6 * s + (noise() - 0.5) * 0.1, 11, 13), 2),
    conductivity_us_cm: round(clamp(12000 + condOffset + 2000 * s + (noise() - 0.5) * 100, 9000, 15000), 0),
    turbidity_ntu: round(clamp(20 + 12 * s + (noise() - 0.5) * 2, 5, 40), 1),
  };
}
