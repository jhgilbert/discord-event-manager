import type { EventRow, RsvpRow } from './types.js';
import { seatsTakenBy } from './types.js';

export interface CapacitySummary {
  capacity: number;
  taken: number;
  /** Negative when a host lowered capacity below the confirmed headcount. */
  remaining: number;
  isFull: boolean;
  isOverSubscribed: boolean;
}

/**
 * Capacity is total headcount: a guest occupies a seat exactly as a member
 * does. There is no separate guest pool, so there is no way for seats to sit
 * empty while a member is refused a +1.
 */
export function countTakenSeats(confirmed: RsvpRow[]): number {
  return confirmed.reduce((total, rsvp) => total + seatsTakenBy(rsvp), 0);
}

export function summarizeCapacity(event: EventRow, confirmed: RsvpRow[]): CapacitySummary {
  const taken = countTakenSeats(confirmed);
  const remaining = event.capacity - taken;

  return {
    capacity: event.capacity,
    taken,
    remaining,
    isFull: remaining <= 0,
    isOverSubscribed: remaining < 0,
  };
}

export function seatsRequestedBy(plusOne: boolean): number {
  return plusOne ? 2 : 1;
}
