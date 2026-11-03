CREATE TABLE IF NOT EXISTS sheet_sync_state(id INTEGER PRIMARY KEY CHECK(id=1),status TEXT NOT NULL DEFAULT 'never',active_version TEXT,last_attempt TEXT,last_success TEXT,error_code TEXT,lease TEXT,lease_until INTEGER);
CREATE TABLE IF NOT EXISTS sheet_live_producers(version TEXT NOT NULL,producer_id TEXT NOT NULL,payload TEXT NOT NULL,fetched_at TEXT NOT NULL,PRIMARY KEY(version,producer_id));
CREATE TABLE IF NOT EXISTS sheet_live_items(version TEXT NOT NULL,producer_id TEXT NOT NULL,item_id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(version,producer_id,item_id));
INSERT OR IGNORE INTO sheet_sync_state(id,status) VALUES(1,'never');
