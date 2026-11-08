import type { EventDatabase } from './database.js';
import { insertRsvp } from './rsvp-queries.js';
import type { EventDetails, EventRow } from '../domain/types.js';

export type NewEvent = EventDetails & {
  messageId: string;
  threadId: string;
  guildId: string;
  hostId: string;
  hostDisplayName: string | null;
};

/**
 * `plus_ones_allowed_from` is written as NULL ("not allowed") rather than left to
 * the column default, which says "allowed" for the sake of events that predate
 * the setting.
 */
function insertEvent(database: EventDatabase, event: NewEvent): void {
  database
    .prepare(
      `INSERT INTO events
         (message_id, thread_id, guild_id, host_id, title, description, location, starts_at, capacity, created_at, plus_ones_allowed_from, host_display_name)
       VALUES
         (@messageId, @threadId, @guildId, @hostId, @title, @description, @location, @startsAt, @capacity, @createdAt, NULL, @hostDisplayName)`,
    )
    .run({ ...event, createdAt: Math.floor(Date.now() / 1000) });
}

/**
 * The only way an event is created, because a host is always going to their own
 * event. Seating them here rather than leaving them to click means the roster
 * matches reality from the first render, and — since capacity is total headcount
 * — that the host's own seat is never sold to somebody else.
 *
 * One transaction: an event whose host is missing from its own roster would
 * render as a plausible-looking empty list rather than as an error anyone would
 * notice.
 */
export function insertEventAndSeatHost(database: EventDatabase, event: NewEvent): void {
  const insertBoth = database.transaction(() => {
    insertEvent(database, event);
    insertRsvp(database, {
      messageId: event.messageId,
      userId: event.hostId,
      displayName: event.hostDisplayName,
      plusOne: false,
      status: 'confirmed',
    });
  });

  insertBoth();
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

export function updateHostDisplayName(
  database: EventDatabase,
  messageId: string,
  displayName: string,
): void {
  database
    .prepare('UPDATE events SET host_display_name = ? WHERE message_id = ?')
    .run(displayName, messageId);
}

export function markEventCancelled(database: EventDatabase, messageId: string): void {
  database.prepare('UPDATE events SET cancelled = 1 WHERE message_id = ?').run(messageId);
}

/**
 * Erases the event and its RSVPs together. There is no foreign key between the
 * two tables, so the cascade is written out here — and wrapped in a transaction,
 * because an event row surviving without its RSVPs would render as an empty
 * roster rather than as an error anyone would notice.
 */
export function deleteEventAndRsvps(database: EventDatabase, messageId: string): void {
  const deleteBoth = database.transaction((id: string) => {
    database.prepare('DELETE FROM rsvps WHERE message_id = ?').run(id);
    database.prepare('DELETE FROM events WHERE message_id = ?').run(id);
  });

  deleteBoth(messageId);
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

/**
 * `unlockPending` is set when the date is still ahead, so the sweep knows to
 * re-render the panel once it passes — nothing else would, on a quiet event.
 */
export function updatePlusOnePolicy(
  database: EventDatabase,
  messageId: string,
  allowedFrom: number | null,
  unlockPending: boolean,
): void {
  database
    .prepare(
      `UPDATE events
          SET plus_ones_allowed_from = ?,
              plus_one_unlock_pending = ?
        WHERE message_id = ?`,
    )
    .run(allowedFrom, unlockPending ? 1 : 0, messageId);
}

export function findEventsDueForPlusOneUnlock(database: EventDatabase, now: number): EventRow[] {
  return database
    .prepare(
      `SELECT * FROM events
        WHERE plus_one_unlock_pending = 1
          AND plus_ones_allowed_from <= ?
          AND cancelled = 0`,
    )
    .all(now) as EventRow[];
}

export function clearPlusOneUnlockPending(database: EventDatabase, messageId: string): void {
  database
    .prepare('UPDATE events SET plus_one_unlock_pending = 0 WHERE message_id = ?')
    .run(messageId);
}
