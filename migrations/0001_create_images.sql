CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  direct_url TEXT NOT NULL UNIQUE,
  src_url TEXT NOT NULL,
  storage_uri TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published'
);

CREATE INDEX IF NOT EXISTS idx_images_gallery
  ON images (status, created_at DESC);
