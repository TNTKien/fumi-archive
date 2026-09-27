CREATE TABLE IF NOT EXISTS upload_quotas (
  day TEXT NOT NULL,
  actor_hash TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, actor_hash)
);
