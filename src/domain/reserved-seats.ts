import { z } from 'zod';
import type { RsvpRow } from './types.js';

/**
 * A seat the host holds for someone who is not on Discord. It is stored as an
 * ordinary RSVP row, so capacity, the waitlist and FIFO promotion treat it
 * exactly like anyone else's — the only differences are who gets pinged about
 * it and how it is named.
 *
 * The row's `user_id` is a key built from the name rather than a Discord ID.
 * Snowflakes are all digits, so the prefix can never collide with a real
 * member, and the table's primary key is what keeps names unique per event.
 */
const RESERVED_SEAT_KEY_PREFIX = 'reserved:';

/** Short enough to sit on one roster line on a phone. */
export const RESERVED_NAME_MAX_LENGTH = 50;

/**
 * Case-insensitive, so "levi" and "Levi" are one person: otherwise
 * `release-seat` would depend on the host remembering how they capitalised it.
 */
export function buildReservedSeatKey(name: string): string {
  return `${RESERVED_SEAT_KEY_PREFIX}${name.toLocaleLowerCase()}`;
}

export function isReservedSeat(rsvp: RsvpRow): boolean {
  return rsvp.reserved_by !== null;
}

/**
 * Levi cannot be pinged, so whoever reserved his seat hears about it instead —
 * a promotion, a moved time, a cancellation.
 */
export function whoToNotifyFor(rsvp: RsvpRow): string {
  return rsvp.reserved_by ?? rsvp.user_id;
}

/** Deduplicated: a host holding three seats is pinged once, not three times. */
export function listWhoToNotify(rsvps: RsvpRow[]): string[] {
  return [...new Set(rsvps.map(whoToNotifyFor))];
}

/** Collapses runs of spaces, so "Levi  B." and "Levi B." are the same seat. */
const reservedNameSchema = z
  .string()
  .transform((name) => name.trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(1, 'Type the name of the person the seat is for.')
      .max(
        RESERVED_NAME_MAX_LENGTH,
        `Names can be at most ${RESERVED_NAME_MAX_LENGTH} characters.`,
      ),
  );

export type ParsedReservedName = { ok: true; name: string } | { ok: false; problem: string };

export function parseReservedName(raw: string): ParsedReservedName {
  const result = reservedNameSchema.safeParse(raw);
  return result.success
    ? { ok: true, name: result.data }
    : { ok: false, problem: result.error.issues[0]?.message ?? 'That name could not be used.' };
}
