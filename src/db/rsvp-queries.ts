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
  rsvp: { messageId: string; userId: string; plusOne: boolean; status: RsvpStatus },
): void {
  database
    .prepare(
      `INSERT INTO rsvps (message_id, user_id, plus_one, status, created_at)
       VALUES (@messageId, @userId, @plusOne, @status, @createdAt)`,
    )
    .run({ ...rsvp, plusOne: rsvp.plusOne ? 1 : 0, createdAt: Math.floor(Date.now() / 1000) });
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

export function deleteRsvp(database: EventDatabase, messageId: string, userId: string): void {
  database.prepare('DELETE FROM rsvps WHERE message_id = ? AND user_id = ?').run(messageId, userId);
}
