CREATE TABLE IF NOT EXISTS meta_assets(id TEXT PRIMARY KEY,platform TEXT NOT NULL,name TEXT NOT NULL,page_id TEXT,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta_content(id TEXT PRIMARY KEY,asset_id TEXT NOT NULL,platform TEXT NOT NULL,kind TEXT NOT NULL,published_at TEXT,caption TEXT,permalink TEXT,thumbnail_url TEXT,first_seen TEXT NOT NULL,last_seen TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS meta_content_time ON meta_content(published_at DESC);
CREATE TABLE IF NOT EXISTS meta_capabilities(asset_id TEXT NOT NULL,kind TEXT NOT NULL,metric TEXT NOT NULL,status TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',checked_at TEXT NOT NULL,PRIMARY KEY(asset_id,kind,metric));
CREATE TABLE IF NOT EXISTS meta_snapshots(asset_id TEXT NOT NULL,kind TEXT NOT NULL,metric TEXT NOT NULL,observed_at TEXT NOT NULL,value REAL NOT NULL,source_period TEXT NOT NULL,PRIMARY KEY(asset_id,kind,metric,observed_at));
CREATE INDEX IF NOT EXISTS meta_snapshots_asset ON meta_snapshots(asset_id,metric,observed_at);
