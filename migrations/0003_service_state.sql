CREATE TABLE IF NOT EXISTS service_state (
  key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  alerted_at TEXT,
  last_error TEXT
);

INSERT OR IGNORE INTO service_state (
  key,
  status,
  changed_at,
  alerted_at,
  last_error
) VALUES (
  'tiktok_session',
  'healthy',
  CURRENT_TIMESTAMP,
  NULL,
  NULL
);
