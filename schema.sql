CREATE TABLE IF NOT EXISTS failures (
  source TEXT NOT NULL,
  event_id TEXT NOT NULL,
  happened_at TEXT NOT NULL,
  workflow_name TEXT NOT NULL DEFAULT '',
  workflow_url TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'error',
  message TEXT NOT NULL DEFAULT '',
  service TEXT NOT NULL DEFAULT '',
  ingested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source, event_id)
);
CREATE INDEX IF NOT EXISTS failures_time ON failures(happened_at DESC);
CREATE TABLE IF NOT EXISTS producers (
  producer_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  account TEXT NOT NULL DEFAULT '',
  creator_handle TEXT NOT NULL DEFAULT '',
  threshold INTEGER NOT NULL DEFAULT 3,
  sheet_backed INTEGER NOT NULL DEFAULT 0,
  workflow_names TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS producer_items (
  producer_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_label TEXT NOT NULL DEFAULT '',
  item_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  approved TEXT NOT NULL DEFAULT '',
  ready INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (producer_id, item_id),
  FOREIGN KEY (producer_id) REFERENCES producers(producer_id)
);
CREATE INDEX IF NOT EXISTS producer_items_ready ON producer_items(producer_id, ready);
