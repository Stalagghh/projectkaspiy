// Types only (safe to import from client components).
export type Geometry = { type: string; coordinates: unknown };
export type Feature = { type: 'Feature'; id: string; geometry: Geometry; properties: Record<string, unknown> };
export type FeatureCollection = { type: 'FeatureCollection'; features: Feature[] };

export type DeviceSensor = {
  sensorId: string;
  metric: string;
  unit: string;
  value: number | null;
  ts: string | null;
  quality: 'ok' | 'suspect' | null;
};

export type MapGeo = {
  area: FeatureCollection;
  opsArea: FeatureCollection;
  zones: FeatureCollection;
  haulouts: FeatureCollection;
  devices: FeatureCollection;
  /** [west, south, east, north] of the operational area, or null when not seeded. */
  opsBounds: [number, number, number, number] | null;
};

/** Properties of one feature of `MapGeo.devices`. */
export type MapDevice = {
  id: string;
  kind: 'acoustic_buoy' | 'water_station' | (string & {});
  name: string;
  isSimulated: boolean;
  lastSeenAt: string | null;
  sensors: DeviceSensor[];
};
