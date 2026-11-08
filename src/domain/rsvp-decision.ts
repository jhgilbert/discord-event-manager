import type { RsvpRow } from './types.js';
import { seatsTakenBy } from './types.js';
import { seatsRequestedBy } from './capacity.js';

export type RsvpDecision =
  /** Write the RSVP as confirmed (covers joining, and dropping a +1). */
  | { kind: 'seat'; plusOne: boolean }
  /** Write the RSVP as waitlisted. Reconcile decides whether it stays there. */
  | { kind: 'waitlist'; plusOne: boolean }
  /** Their existing confirmed RSVP is left exactly as it was. */
  | { kind: 'reject-upgrade'; reason: 'no-room' | 'waitlist-ahead' }
  /** +1s are closed and they asked for a guest they don't already have. Nothing is written. */
  | { kind: 'reject-plus-one' }
  /** They clicked the button matching what they already have. */
  | { kind: 'no-change' };

export interface RsvpDecisionInput {
  existing: RsvpRow | null;
  requestedPlusOne: boolean;
  remaining: number;
  waitlistIsEmpty: boolean;
  plusOnesOpen: boolean;
}

/**
 * Strict FIFO means a seat freed by anyone belongs to the head of the queue.
 * So while a waitlist exists, no seat is granted here at all — only
 * `reconcileEvent` promotes, and it promotes in join order. Without this gate a
 * newcomer clicking "RSVP" could take a seat the queue was waiting on.
 */
function canTakeSeatsNow(input: RsvpDecisionInput, seatsNeeded: number): boolean {
  return input.waitlistIsEmpty && seatsNeeded <= input.remaining;
}

function decideForNewcomer(input: RsvpDecisionInput): RsvpDecision {
  const seatsNeeded = seatsRequestedBy(input.requestedPlusOne);

  return canTakeSeatsNow(input, seatsNeeded)
    ? { kind: 'seat', plusOne: input.requestedPlusOne }
    : { kind: 'waitlist', plusOne: input.requestedPlusOne };
}

/**
 * A queued member may freely change their own guest flag; it costs no seat
 * while they are waiting. Dropping the +1 is how a queue-blocked member with a
 * guest unblocks themselves: reconcile can then fit them into a single seat.
 */
function decideForWaitlistedMember(input: RsvpDecisionInput, existing: RsvpRow): RsvpDecision {
  const alreadyMatches = Boolean(existing.plus_one) === input.requestedPlusOne;

  return alreadyMatches ? { kind: 'no-change' } : { kind: 'waitlist', plusOne: input.requestedPlusOne };
}

/**
 * The delta matters, not the total. A confirmed solo member clicking "RSVP
 * +1" needs *one* more seat, not two — recomputing from scratch would refuse
 * them on an event with a single seat left.
 */
function decideForConfirmedMember(input: RsvpDecisionInput, existing: RsvpRow): RsvpDecision {
  const seatsNeeded = seatsRequestedBy(input.requestedPlusOne) - seatsTakenBy(existing);

  if (seatsNeeded === 0) {
    return { kind: 'no-change' };
  }

  // Giving up a seat always succeeds, and frees room for the queue.
  if (seatsNeeded < 0) {
    return { kind: 'seat', plusOne: input.requestedPlusOne };
  }

  if (canTakeSeatsNow(input, seatsNeeded)) {
    return { kind: 'seat', plusOne: input.requestedPlusOne };
  }

  // Never silently seat them solo: someone who believes they got a +1 will
  // show up with a person. Reject the upgrade and leave the existing RSVP be.
  return {
    kind: 'reject-upgrade',
    reason: input.waitlistIsEmpty ? 'no-room' : 'waitlist-ahead',
  };
}

/**
 * Only *adding* a guest is gated. Someone who already has one keeps them while
 * +1s are closed — clicking "RSVP +1" again is a no-change, not a refusal — so
 * a host closing +1s never takes away a guest somebody was promised.
 *
 * A newcomer asking for a guest is refused outright rather than seated solo,
 * for the same reason an upgrade is: they would turn up with a person.
 */
function wouldAddAGuestWhileClosed(input: RsvpDecisionInput): boolean {
  return input.requestedPlusOne && !input.plusOnesOpen && !input.existing?.plus_one;
}

export function decideRsvpOutcome(input: RsvpDecisionInput): RsvpDecision {
  if (wouldAddAGuestWhileClosed(input)) {
    return { kind: 'reject-plus-one' };
  }

  if (input.existing === null) {
    return decideForNewcomer(input);
  }

  return input.existing.status === 'waitlist'
    ? decideForWaitlistedMember(input, input.existing)
    : decideForConfirmedMember(input, input.existing);
}
