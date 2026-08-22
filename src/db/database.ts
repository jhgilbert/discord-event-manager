import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { SCHEMA_STATEMENTS } from './schema.js';
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

export function openDatabase(databasePath: string): EventDatabase {
  ensureDatabaseDirectoryExists(databasePath);

  const database = new Database(databasePath);
  applyDurabilityPragmas(database);
  database.exec(SCHEMA_STATEMENTS);

  logger.info('database ready', { databasePath });
  return database;
}
