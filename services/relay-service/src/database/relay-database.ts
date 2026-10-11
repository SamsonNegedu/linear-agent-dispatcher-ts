import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

export type RelayDatabase = Database.Database;
export const RELAY_DATABASE = 'RELAY_DATABASE';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS subscribers (
    subscriber_id     TEXT PRIMARY KEY,
    team_key          TEXT NOT NULL,
    linear_user_id    TEXT NOT NULL,
    domains           TEXT NOT NULL DEFAULT '[]',
    local_endpoint    TEXT NOT NULL,
    subscriber_secret TEXT NOT NULL,
    registered_at     TEXT NOT NULL,
    last_seen_at      TEXT NOT NULL,
    last_webhook_at   TEXT,
    version           INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS subscribers_team ON subscribers (team_key);

  CREATE TABLE IF NOT EXISTS webhook_deliveries (
    delivery_id        TEXT PRIMARY KEY,
    timestamp          TEXT NOT NULL,
    subscriber_id      TEXT NOT NULL,
    team_key           TEXT NOT NULL,
    webhook_id         TEXT NOT NULL,
    issue_id           TEXT NOT NULL,
    issue_identifier   TEXT NOT NULL,
    status             TEXT NOT NULL,
    response_time      INTEGER,
    error_message      TEXT,
    linear_assignee_id TEXT
  );
  CREATE INDEX IF NOT EXISTS webhook_deliveries_timestamp ON webhook_deliveries (timestamp);
`;

/** Opens (creating if needed) the relay's SQLite file, or an in-memory one for ':memory:'. */
export function openRelayDatabase(path: string): RelayDatabase {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}
