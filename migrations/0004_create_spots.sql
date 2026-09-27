CREATE TABLE IF NOT EXISTS spots (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  direct_url TEXT NOT NULL,
  src_url TEXT NOT NULL,
  storage_uri TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  location_mode TEXT NOT NULL CHECK (location_mode IN ('exact','approximate','city')),
  location_name TEXT,
  city TEXT,
  country TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published'
);

CREATE INDEX IF NOT EXISTS idx_spots_gallery
  ON spots (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_spots_geo
  ON spots (status, latitude, longitude);
