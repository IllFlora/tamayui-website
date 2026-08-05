CREATE TABLE IF NOT EXISTS media_items (
  id TEXT PRIMARY KEY,
  collection TEXT NOT NULL CHECK (collection IN ('works', 'classroom', 'students')),
  storage_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  alt_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'draft')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_media_collection_order
  ON media_items (collection, status, sort_order, created_at);

CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  page_path TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  experiment_key TEXT NOT NULL DEFAULT '',
  variant TEXT NOT NULL DEFAULT '',
  utm_source TEXT NOT NULL DEFAULT '',
  utm_medium TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_events_occurred_at
  ON analytics_events (occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_name_target
  ON analytics_events (event_name, target, occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_session
  ON analytics_events (session_id, occurred_at);
