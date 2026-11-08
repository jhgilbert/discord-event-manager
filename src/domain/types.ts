/**
 * Row shapes as they exist in SQLite (integers for booleans, unix seconds for
 * times). These are not validated with Zod because they are not untrusted
 * input — this process is the only writer, and a Zod parse on every read would
 * buy nothing but latency. Zod guards the two real boundaries instead:
 * environment variables and modal submissions.
 */

export type RsvpStatus = 'confirmed' | 'waitlist';

export interface EventRow {
  message_id: string;
  thread_id: string;
  guild_id: string;
  host_id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: number;
  capacity: number;
  cancelled: number;
  reminder_sent: number;
  created_at: number;
  /** See domain/plus-one-policy.ts — read through `readPlusOnePolicy`. */
  plus_ones_allowed_from: number | null;
  plus_one_unlock_pending: number;
  host_display_name: string | null;
  /** 1 once the day it started is over. See jobs/past-event-job.ts. */
  ended: number;
}

export interface RsvpRow {
  message_id: string;
  user_id: string;
  plus_one: number;
  status: RsvpStatus;
  created_at: number;
  /** Null for RSVPs from before names were stored, until a lookup fills it in. */
  display_name: string | null;
  /** Who reserved this seat for someone not on Discord. See domain/reserved-seats.ts. */
  reserved_by: string | null;
}

/** The fields the host controls through the modal, in both create and edit. */
export interface EventDetails {
  title: string;
  description: string | null;
  location: string | null;
  startsAt: number;
  capacity: number;
}

export function seatsTakenBy(rsvp: RsvpRow): number {
  return 1 + (rsvp.plus_one ? 1 : 0);
}

export function isConfirmed(rsvp: RsvpRow): boolean {
  return rsvp.status === 'confirmed';
}

export function isWaitlisted(rsvp: RsvpRow): boolean {
  return rsvp.status === 'waitlist';
}
