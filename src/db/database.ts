import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { POST_MIGRATION_STATEMENTS, SCHEMA_STATEMENTS } from './schema.js';
import { logger } from '../lib/logger.js';

export type EventDatabase = Database.Database;

/**
 * On Railway the volume is mounted at DATABASE_PATH's directory. It exists by
 * the time the process starts, but creating it here means a local run with
 * DATABASE_PATH=./data/events.db works with no setup.
 */
function ensureDatabaseDirectoryExists(databasePath: string): void {
  mkdirSync(dirname(databasePath), { recursive: true });
}

function applyDurabilityPragmas(database: EventDatabase): void {
  // WAL survives an unclean container stop far better than the default
  // rollback journal, and lets the reminder sweep read while a click writes.
  database.pragma('journal_mode = WAL');
  database.pragma('synchronous = NORMAL');
  database.pragma('foreign_keys = ON');
  // A click that finds the DB briefly locked should wait, not throw.
  database.pragma('busy_timeout = 5000');
}

function tableHasColumn(database: EventDatabase, table: string, column: string): boolean {
  const columns = database.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return columns.some((existing) => existing.name === column);
}

/**
 * `CREATE TABLE IF NOT EXISTS` is a no-op once a table exists, so a column added
 * after a deploy needs its own idempotent step. Adding a column with a default
 * is the only migration shape SQLite does cheaply, and the only one used here.
 */
function addColumnIfMissing(
  database: EventDatabase,
  table: string,
  column: string,
  definition: string,
): void {
  if (tableHasColumn(database, table, column)) {
    return;
  }

  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  logger.info('added missing column', { table, column });
}

export function openDatabase(databasePath: string): EventDatabase {
  ensureDatabaseDirectoryExists(databasePath);

  const database = new Database(databasePath);
  applyDurabilityPragmas(database);
  database.exec(SCHEMA_STATEMENTS);
  addColumnIfMissing(database, 'events', 'created_at', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(database, 'events', 'plus_ones_allowed_from', 'INTEGER DEFAULT 0');
  addColumnIfMissing(database, 'events', 'plus_one_unlock_pending', 'INTEGER NOT NULL DEFAULT 0');
  database.exec(POST_MIGRATION_STATEMENTS);

  logger.info('database ready', { databasePath });
  return database;
}
