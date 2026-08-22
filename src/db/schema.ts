/**
 * Kept as a TypeScript string rather than a .sql file so `tsc` alone produces a
 * runnable `dist/` — no asset-copying step to forget.
 *
 * Every statement is idempotent, so this runs on every boot as the migration.
 */
export const SCHEMA_STATEMENTS = `
CREATE TABLE IF NOT EXISTS events (
  message_id    TEXT PRIMARY KEY,   -- starter message; == thread_id for forum posts
  thread_id     TEXT NOT NULL,
  guild_id      TEXT NOT NULL,
  host_id       TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  location      TEXT,
  starts_at     INTEGER NOT NULL,   -- unix seconds
  capacity      INTEGER NOT NULL,
  cancelled     INTEGER NOT NULL DEFAULT 0,
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL DEFAULT 0   -- unix seconds; 0 means "unknown"
);

CREATE TABLE IF NOT EXISTS rsvps (
  message_id TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  plus_one   INTEGER NOT NULL DEFAULT 0,
  status     TEXT    NOT NULL,      -- 'confirmed' | 'waitlist'
  created_at INTEGER NOT NULL,      -- never updated on promotion
  PRIMARY KEY (message_id, user_id)
);

-- Reconcile reads the waitlist in join order on every mutation; this keeps that
-- a scan of one index rather than a sort of the whole table.
CREATE INDEX IF NOT EXISTS rsvps_by_event_order
  ON rsvps (message_id, status, created_at);

-- The reminder sweep runs once a minute forever, so it should never scan the
-- full events table.
CREATE INDEX IF NOT EXISTS events_pending_reminders
  ON events (reminder_sent, starts_at);
`;
