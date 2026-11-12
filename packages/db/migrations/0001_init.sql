-- Core schema for Milestone A. All geometries are WGS 84 (SRID 4326).
-- Applied by packages/db/src/migrate.ts in a transaction, once.

CREATE EXTENSION IF NOT EXISTS postgis;

-- Protected area: the OSM boundary plus the illustrative operational sea area.
CREATE TABLE areas (
  id text PRIMARY KEY,
  name_ru text NOT NULL,
  name_en text NOT NULL,
  boundary geometry(MultiPolygon, 4326) NOT NULL,
  boundary_source text NOT NULL,
  ops_area geometry(MultiPolygon, 4326) NOT NULL,
  attribution text NOT NULL
);

-- Regime zones. Demonstration only: no legal status is claimed.
CREATE TABLE zones (
  id text PRIMARY KEY,
  area_id text NOT NULL REFERENCES areas (id),
  kind text NOT NULL CHECK (kind IN ('no_entry', 'buffer')),
  name_ru text NOT NULL,
  name_en text NOT NULL,
  geom geometry(Polygon, 4326) NOT NULL,
  is_illustrative boolean NOT NULL DEFAULT true
);
CREATE INDEX zones_geom_idx ON zones USING gist (geom);

-- Candidate seal haul-out sites (assumption A-S3, to be validated by ecologists).
CREATE TABLE haulouts (
  id text PRIMARY KEY,
  area_id text NOT NULL REFERENCES areas (id),
  name_ru text NOT NULL,
  name_en text NOT NULL,
  location geometry(Point, 4326) NOT NULL,
  osm_ref text,
  is_candidate boolean NOT NULL DEFAULT true
);

CREATE TABLE devices (
  id text PRIMARY KEY,
  area_id text NOT NULL REFERENCES areas (id),
  kind text NOT NULL CHECK (kind IN ('acoustic_buoy', 'water_station')),
  name_ru text NOT NULL,
  location geometry(Point, 4326) NOT NULL,
  is_simulated boolean NOT NULL,
  last_seen_at timestamptz,
  boot_id bigint,
  last_seq bigint
);

CREATE TABLE sensors (
  id text PRIMARY KEY,
  device_id text NOT NULL REFERENCES devices (id),
  metric text NOT NULL CHECK (metric IN ('water_temp_c', 'conductivity_us_cm', 'turbidity_ntu')),
  unit text NOT NULL,
  UNIQUE (device_id, metric)
);

-- The primary key (sensor_id, ts) serves "readings of a sensor over time" in both directions.
CREATE TABLE readings (
  sensor_id text NOT NULL REFERENCES sensors (id),
  ts timestamptz NOT NULL,
  value double precision NOT NULL,
  quality text NOT NULL CHECK (quality IN ('ok', 'suspect')),
  PRIMARY KEY (sensor_id, ts)
);

-- Audio is stored in the database (not in the web root) and served only through the API.
CREATE TABLE audio_clips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('device', 'upload')),
  device_id text REFERENCES devices (id),
  boot_id bigint,
  seq bigint,
  area_id text REFERENCES areas (id),
  location geometry(Point, 4326),
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  duration_s real,
  sample_rate integer,
  sha256 text NOT NULL,
  mime text NOT NULL,
  audio bytea NOT NULL,
  spectrogram_png bytea,
  status text NOT NULL CHECK (status IN ('pending', 'done', 'failed', 'awaiting_ml')),
  error text,
  is_simulated boolean NOT NULL DEFAULT false,
  scenario_run_id uuid,
  -- Idempotency: the same device message is stored once even if MQTT delivers it twice.
  UNIQUE (device_id, boot_id, seq)
);
CREATE INDEX audio_clips_status_idx ON audio_clips (status) WHERE status IN ('pending', 'awaiting_ml');

CREATE TABLE detections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id uuid NOT NULL REFERENCES audio_clips (id) ON DELETE CASCADE,
  label text NOT NULL CHECK (label IN ('boat_engine', 'gunshot', 'background')),
  confidence real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  qualitative text NOT NULL CHECK (qualitative IN ('high', 'medium', 'low')),
  start_s real,
  end_s real,
  top_classes jsonb NOT NULL,
  model_name text NOT NULL,
  model_version text NOT NULL,
  threshold real NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX detections_clip_idx ON detections (clip_id);

CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id text NOT NULL REFERENCES areas (id),
  zone_id text REFERENCES zones (id),
  kind text NOT NULL CHECK (kind IN ('gunshot', 'boat_in_no_entry_zone', 'boat_detected', 'acoustic_unclassified')),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  priority integer NOT NULL,
  priority_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'acknowledged', 'assigned', 'resolved', 'false_positive')),
  location geometry(Point, 4326),
  device_id text REFERENCES devices (id),
  clip_id uuid REFERENCES audio_clips (id) ON DELETE SET NULL,
  detection_id uuid REFERENCES detections (id) ON DELETE SET NULL,
  related_alert_id uuid REFERENCES alerts (id) ON DELETE SET NULL,
  event_at timestamptz NOT NULL,
  is_simulated boolean NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolution_note text
);
CREATE INDEX alerts_status_created_idx ON alerts (status, created_at DESC);
CREATE INDEX alerts_created_idx ON alerts (created_at DESC);
CREATE INDEX alerts_location_idx ON alerts USING gist (location);

-- Forecast grid: hexagons over the operational sea area.
CREATE TABLE forecast_cells (
  id integer PRIMARY KEY,
  area_id text NOT NULL REFERENCES areas (id),
  geom geometry(Polygon, 4326) NOT NULL,
  centroid geometry(Point, 4326) NOT NULL,
  dist_haulout_km real NOT NULL,
  dist_coast_km real NOT NULL
);
CREATE INDEX forecast_cells_geom_idx ON forecast_cells USING gist (geom);

CREATE TABLE forecast_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id text NOT NULL REFERENCES areas (id),
  issued_at timestamptz NOT NULL,
  start_date date NOT NULL,
  days integer NOT NULL,
  model_name text NOT NULL,
  model_version text NOT NULL,
  -- Per-day inputs with their sources and real/synthetic labels (shown in the UI).
  hydrology jsonb NOT NULL,
  -- Per-day plain-language summaries: [{date, summaryRu, summaryEn}].
  summaries jsonb NOT NULL,
  assumptions jsonb NOT NULL
);
CREATE INDEX forecast_runs_issued_idx ON forecast_runs (area_id, issued_at DESC);

CREATE TABLE forecast_values (
  run_id uuid NOT NULL REFERENCES forecast_runs (id) ON DELETE CASCADE,
  day date NOT NULL,
  cell_id integer NOT NULL REFERENCES forecast_cells (id),
  presence real NOT NULL,
  level text NOT NULL CHECK (level IN ('low', 'medium', 'high')),
  factors jsonb NOT NULL,
  PRIMARY KEY (run_id, day, cell_id)
);

-- Live updates: the web server LISTENs on these channels and forwards them over SSE.
-- Payloads carry identifiers only; the web server loads the data it is allowed to show.
CREATE FUNCTION notify_alert_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('alert_changes', json_build_object('id', NEW.id, 'op', lower(TG_OP))::text);
  RETURN NEW;
END $$;
CREATE TRIGGER alerts_notify AFTER INSERT OR UPDATE ON alerts
  FOR EACH ROW EXECUTE FUNCTION notify_alert_change();

CREATE FUNCTION notify_reading() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('readings', json_build_object('sensorId', NEW.sensor_id, 'ts', NEW.ts)::text);
  RETURN NEW;
END $$;
CREATE TRIGGER readings_notify AFTER INSERT ON readings
  FOR EACH ROW EXECUTE FUNCTION notify_reading();
