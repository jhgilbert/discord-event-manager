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
  created_at    INTEGER NOT NULL DEFAULT 0,  -- unix seconds; 0 means "unknown"
  -- unix seconds; NULL = +1s not allowed, 0 = allowed from the start. The
  -- default is "allowed" so events from before the column existed keep working
  -- as they did; new events always write it explicitly. See plus-one-policy.ts.
  plus_ones_allowed_from  INTEGER DEFAULT 0,
  -- 1 while the panel still shows a +1 button that a future date will unlock.
  plus_one_unlock_pending INTEGER NOT NULL DEFAULT 0
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

/**
 * Indexes on columns that older databases only gain from `addColumnIfMissing`,
 * so they have to run after it rather than with the statements above.
 */
export const POST_MIGRATION_STATEMENTS = `
-- The +1 unlock sweep runs once a minute too, and almost never finds anything.
CREATE INDEX IF NOT EXISTS events_pending_plus_one_unlocks
  ON events (plus_one_unlock_pending, plus_ones_allowed_from);
`;
