-- Additive and repeatable. Existing producer, failure, and Meta tables stay intact.
CREATE TABLE IF NOT EXISTS content_posts (
 platform TEXT NOT NULL, account_id TEXT NOT NULL, post_id TEXT NOT NULL,
 account_handle TEXT NOT NULL DEFAULT '', permalink TEXT NOT NULL,
 media_type TEXT NOT NULL, published_at TEXT, caption TEXT NOT NULL DEFAULT '',
 workflow_id TEXT NOT NULL DEFAULT '', workflow_url TEXT NOT NULL DEFAULT '',
 preview_url TEXT NOT NULL DEFAULT '', preview_type TEXT NOT NULL DEFAULT '',
 metrics TEXT NOT NULL DEFAULT '{}', fingerprint TEXT,
 first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
 delete_status TEXT NOT NULL DEFAULT 'published',
 PRIMARY KEY(platform,account_id,post_id)
);
CREATE INDEX IF NOT EXISTS content_permalink ON content_posts(permalink);
CREATE INDEX IF NOT EXISTS content_date ON content_posts(published_at DESC);
CREATE TABLE IF NOT EXISTS content_observations (
 platform TEXT NOT NULL,account_id TEXT NOT NULL,post_id TEXT NOT NULL,
 observed_at TEXT NOT NULL,metrics TEXT NOT NULL,
 PRIMARY KEY(platform,account_id,post_id,observed_at)
);
CREATE TABLE IF NOT EXISTS content_duplicate_groups (
 group_id TEXT PRIMARY KEY,platform TEXT NOT NULL,account_id TEXT NOT NULL,
 media_type TEXT NOT NULL,algorithm TEXT NOT NULL,confidence TEXT NOT NULL,
 members TEXT NOT NULL,evidence TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS content_cleanup_plans (
 plan_id TEXT PRIMARY KEY,group_id TEXT NOT NULL,payload TEXT NOT NULL,
 source_digest TEXT NOT NULL,expires_at TEXT NOT NULL,committed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS content_deletion_queue (
 request_id TEXT PRIMARY KEY,platform TEXT NOT NULL,account_id TEXT NOT NULL,
 post_id TEXT NOT NULL,permalink TEXT NOT NULL,status TEXT NOT NULL,
 reason TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(platform,account_id,post_id)
);
CREATE TABLE IF NOT EXISTS content_sheet_outbox (
 record_key TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',error_code TEXT,updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS content_jobs (
 id TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'never',lease TEXT,lease_until INTEGER,
 last_attempt TEXT,last_success TEXT,error_code TEXT
);
INSERT OR IGNORE INTO content_jobs(id) VALUES('sheet_mirror');

CREATE TABLE IF NOT EXISTS content_collect_state(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
INSERT OR IGNORE INTO content_jobs(id) VALUES('meta_collect');
