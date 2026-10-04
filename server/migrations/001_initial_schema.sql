CREATE TABLE IF NOT EXISTS garages (
  id TEXT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  time_zone VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS owners (
  id TEXT PRIMARY KEY,
  garage_id TEXT NOT NULL REFERENCES garages(id),
  name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  session_id_hash TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL REFERENCES owners(id),
  csrf_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idle_expires_at TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS mechanics (
  id TEXT PRIMARY KEY,
  garage_id TEXT NOT NULL REFERENCES garages(id),
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(32),
  skills VARCHAR(500),
  duty_status VARCHAR(20) NOT NULL DEFAULT 'available',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  garage_id TEXT NOT NULL REFERENCES garages(id),
  job_number VARCHAR(32) NOT NULL,
  status VARCHAR(20) NOT NULL,
  customer_name VARCHAR(160) NOT NULL,
  customer_phone VARCHAR(32),
  vehicle_registration VARCHAR(32) NOT NULL,
  vehicle_make VARCHAR(80),
  vehicle_model VARCHAR(80),
  vehicle_year INTEGER,
  odometer_km INTEGER,
  work_requested TEXT NOT NULL,
  diagnosis TEXT,
  work_performed TEXT,
  internal_notes TEXT,
  assigned_mechanic_id TEXT REFERENCES mechanics(id),
  created_by_user_id TEXT NOT NULL REFERENCES owners(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS job_history (
  id TEXT PRIMARY KEY,
  garage_id TEXT NOT NULL REFERENCES garages(id),
  job_id TEXT NOT NULL REFERENCES jobs(id),
  actor_user_id TEXT NOT NULL REFERENCES owners(id),
  from_status VARCHAR(20) NOT NULL,
  to_status VARCHAR(20) NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions (session_id_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions (idle_expires_at, absolute_expires_at, revoked_at);
CREATE INDEX IF NOT EXISTS idx_mechanics_garage ON mechanics (garage_id, duty_status, archived_at);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs (garage_id, status, updated_at, archived_at);
CREATE INDEX IF NOT EXISTS idx_jobs_registration ON jobs (garage_id, vehicle_registration);
CREATE INDEX IF NOT EXISTS idx_job_history_job ON job_history (job_id, created_at);
