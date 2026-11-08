import type { EventDatabase } from '../db/database.js';
import { findEventByMessageId } from '../db/event-queries.js';
import {
  listConfirmedInJoinOrder,
  listWaitlistInJoinOrder,
  promoteRsvpToConfirmed,
} from '../db/rsvp-queries.js';
import { countTakenSeats } from './capacity.js';
import { seatsTakenBy, type RsvpRow } from './types.js';

/**
 * The single place a waitlisted member becomes confirmed.
 *
 * Called after *every* mutation — RSVP, withdrawal, capacity edit — so no
 * handler needs promotion logic of its own and a capacity change needs no
 * special case. Returns the RSVPs promoted, so the caller can announce them —
 * rows rather than IDs, because a reserved seat is announced to whoever
 * reserved it.
 *
 * Strict FIFO: the loop stops at the first entry that does not fit rather than
 * skipping ahead to a smaller one. A queued member with a guest who is blocking
 * a single open seat unblocks by their own choice, by dropping to solo.
 *
 * Capacity is never enforced retroactively — it only gates this loop. Lower
 * capacity below the confirmed headcount and `remaining` goes negative, nothing
 * is promoted, and existing attendees keep their seats.
 */
export function reconcileEvent(database: EventDatabase, messageId: string): RsvpRow[] {
  const event = findEventByMessageId(database, messageId);
  if (event === null || event.cancelled || event.ended) {
    return [];
  }

  const waiting = listWaitlistInJoinOrder(database, messageId);
  if (waiting.length === 0) {
    return [];
  }

  let remaining = event.capacity - countTakenSeats(listConfirmedInJoinOrder(database, messageId));
  const promoted: RsvpRow[] = [];

  const promoteWhileTheQueueHeadFits = database.transaction(() => {
    for (const candidate of waiting) {
      const seatsNeeded = seatsTakenBy(candidate);
      if (seatsNeeded > remaining) {
        break;
      }

      promoteRsvpToConfirmed(database, messageId, candidate.user_id);
      promoted.push(candidate);
      remaining -= seatsNeeded;
    }
  });

  promoteWhileTheQueueHeadFits();
  return promoted;
}
