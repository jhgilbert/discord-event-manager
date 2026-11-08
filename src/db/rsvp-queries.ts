import type { EventDatabase } from './database.js';
import type { RsvpRow, RsvpStatus } from '../domain/types.js';

export function findRsvp(
  database: EventDatabase,
  messageId: string,
  userId: string,
): RsvpRow | null {
  const row = database
    .prepare('SELECT * FROM rsvps WHERE message_id = ? AND user_id = ?')
    .get(messageId, userId) as RsvpRow | undefined;

  return row ?? null;
}

export function listConfirmedInJoinOrder(database: EventDatabase, messageId: string): RsvpRow[] {
  return database
    .prepare(
      `SELECT * FROM rsvps
        WHERE message_id = ? AND status = 'confirmed'
        ORDER BY created_at ASC, user_id ASC`,
    )
    .all(messageId) as RsvpRow[];
}

export function listWaitlistInJoinOrder(database: EventDatabase, messageId: string): RsvpRow[] {
  return database
    .prepare(
      `SELECT * FROM rsvps
        WHERE message_id = ? AND status = 'waitlist'
        ORDER BY created_at ASC, user_id ASC`,
    )
    .all(messageId) as RsvpRow[];
}

export function insertRsvp(
  database: EventDatabase,
  rsvp: {
    messageId: string;
    userId: string;
    displayName: string | null;
    plusOne: boolean;
    status: RsvpStatus;
    /** Only for a reserved seat; see domain/reserved-seats.ts. */
    reservedBy?: string;
  },
): void {
  database
    .prepare(
      `INSERT INTO rsvps (message_id, user_id, display_name, plus_one, status, created_at, reserved_by)
       VALUES (@messageId, @userId, @displayName, @plusOne, @status, @createdAt, @reservedBy)`,
    )
    .run({
      ...rsvp,
      plusOne: rsvp.plusOne ? 1 : 0,
      createdAt: Math.floor(Date.now() / 1000),
      reservedBy: rsvp.reservedBy ?? null,
    });
}

/**
 * Deliberately never touches `created_at`: a member who is promoted keeps their
 * original join time, so if they later withdraw and rejoin they go to the back
 * of the queue rather than to the position their promotion gave them.
 */
export function updateRsvpPlusOne(
  database: EventDatabase,
  messageId: string,
  userId: string,
  plusOne: boolean,
): void {
  database
    .prepare('UPDATE rsvps SET plus_one = ? WHERE message_id = ? AND user_id = ?')
    .run(plusOne ? 1 : 0, messageId, userId);
}

export function promoteRsvpToConfirmed(
  database: EventDatabase,
  messageId: string,
  userId: string,
): void {
  database
    .prepare(`UPDATE rsvps SET status = 'confirmed' WHERE message_id = ? AND user_id = ?`)
    .run(messageId, userId);
}

export function updateRsvpDisplayName(
  database: EventDatabase,
  messageId: string,
  userId: string,
  displayName: string,
): void {
  database
    .prepare('UPDATE rsvps SET display_name = ? WHERE message_id = ? AND user_id = ?')
    .run(displayName, messageId, userId);
}

/** For `release-seat`'s autocomplete, in the order they were reserved. */
export function listReservedSeats(database: EventDatabase, messageId: string): RsvpRow[] {
  return database
    .prepare(
      `SELECT * FROM rsvps
        WHERE message_id = ? AND reserved_by IS NOT NULL
        ORDER BY created_at ASC, user_id ASC`,
    )
    .all(messageId) as RsvpRow[];
}

export function deleteRsvp(database: EventDatabase, messageId: string, userId: string): void {
  database.prepare('DELETE FROM rsvps WHERE message_id = ? AND user_id = ?').run(messageId, userId);
}
