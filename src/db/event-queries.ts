import type { EventDatabase } from './database.js';
import type { EventDetails, EventRow } from '../domain/types.js';

export function insertEvent(
  database: EventDatabase,
  event: { messageId: string; threadId: string; guildId: string; hostId: string } & EventDetails,
): void {
  database
    .prepare(
      `INSERT INTO events
         (message_id, thread_id, guild_id, host_id, title, description, location, starts_at, capacity, created_at)
       VALUES
         (@messageId, @threadId, @guildId, @hostId, @title, @description, @location, @startsAt, @capacity, @createdAt)`,
    )
    .run({ ...event, createdAt: Math.floor(Date.now() / 1000) });
}

export function findEventByMessageId(database: EventDatabase, messageId: string): EventRow | null {
  const row = database
    .prepare('SELECT * FROM events WHERE message_id = ?')
    .get(messageId) as EventRow | undefined;

  return row ?? null;
}

export function updateEventDetails(
  database: EventDatabase,
  messageId: string,
  details: EventDetails,
): void {
  database
    .prepare(
      `UPDATE events
          SET title = @title,
              description = @description,
              location = @location,
              starts_at = @startsAt,
              capacity = @capacity
        WHERE message_id = @messageId`,
    )
    .run({ ...details, messageId });
}

/**
 * Editing the start time forward past the reminder window should let the
 * reminder fire again, so the flag is cleared whenever the schedule changes.
 */
export function clearReminderSent(database: EventDatabase, messageId: string): void {
  database.prepare('UPDATE events SET reminder_sent = 0 WHERE message_id = ?').run(messageId);
}

export function markEventCancelled(database: EventDatabase, messageId: string): void {
  database.prepare('UPDATE events SET cancelled = 1 WHERE message_id = ?').run(messageId);
}

export function markReminderSent(database: EventDatabase, messageId: string): void {
  database.prepare('UPDATE events SET reminder_sent = 1 WHERE message_id = ?').run(messageId);
}

/**
 * Events whose start time has entered the reminder window and that have not
 * been reminded yet. Includes events already in the past: the sweep marks
 * those sent without posting, so a bot that was down over a weekend does not
 * wake up and spam a batch of stale reminders.
 */
export function findEventsDueForReminder(
  database: EventDatabase,
  windowEndsAt: number,
): EventRow[] {
  return database
    .prepare(
      `SELECT * FROM events
        WHERE reminder_sent = 0
          AND cancelled = 0
          AND starts_at <= ?
        ORDER BY starts_at ASC`,
    )
    .all(windowEndsAt) as EventRow[];
}
