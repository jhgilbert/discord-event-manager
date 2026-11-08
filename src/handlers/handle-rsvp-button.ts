import { MessageFlags, type ButtonInteraction } from 'discord.js';
import type { AppContext } from '../context.js';
import type { EventDatabase } from '../db/database.js';
import { findEventByMessageId, updateHostDisplayName } from '../db/event-queries.js';
import {
  deleteRsvp,
  findRsvp,
  insertRsvp,
  listConfirmedInJoinOrder,
  listWaitlistInJoinOrder,
  updateRsvpDisplayName,
  updateRsvpPlusOne,
} from '../db/rsvp-queries.js';
import { summarizeCapacity } from '../domain/capacity.js';
import { arePlusOnesOpen, readPlusOnePolicy, type PlusOnePolicy } from '../domain/plus-one-policy.js';
import { reconcileEvent } from '../domain/reconcile.js';
import { decideRsvpOutcome, type RsvpDecision } from '../domain/rsvp-decision.js';
import { readRsvpButtonAction, type RsvpButtonAction } from '../discord/custom-ids.js';
import { announcePromotedFromWaitlist } from '../discord/announcements.js';
import { readDisplayName } from '../discord/display-names.js';
import { describeWhyPlusOnesAreClosed } from '../discord/plus-one-copy.js';
import { refreshEventPanel } from '../discord/refresh-event-panel.js';
import { withMessageLock } from '../lib/message-lock.js';
import { describeError, logger } from '../lib/logger.js';

interface RsvpClickOutcome {
  ephemeralMessage: string;
  promotedUserIds: string[];
  threadId: string | null;
}

function findWaitlistPosition(
  database: EventDatabase,
  messageId: string,
  userId: string,
): number | null {
  const index = listWaitlistInJoinOrder(database, messageId).findIndex(
    (rsvp) => rsvp.user_id === userId,
  );
  return index === -1 ? null : index + 1;
}

/**
 * Read after reconcile rather than predicted before it: a member can join the
 * waitlist and be promoted by the same reconcile pass, and the message they see
 * should describe where they actually ended up.
 */
function describeFinalRsvpState(
  database: EventDatabase,
  messageId: string,
  userId: string,
  plusOnesOpen: boolean,
): string {
  const rsvp = findRsvp(database, messageId, userId);

  if (rsvp === null) {
    return "You're off the list. Thanks for letting us know.";
  }

  if (rsvp.status === 'confirmed') {
    return rsvp.plus_one
      ? 'Your spot has been reserved, plus one for your guest. 🎟️'
      : 'Your spot has been reserved. 🎟️';
  }

  const position = findWaitlistPosition(database, messageId, userId) ?? 1;

  if (!rsvp.plus_one) {
    return `This event is full — you're on the waitlist at **#${position}**.`;
  }

  // Strict FIFO means a queued +1 can sit behind a single free seat. Say so, so
  // they know dropping the guest is a choice they can make rather than a bug —
  // and, while +1s are closed, that it is a choice they cannot undo.
  return [
    `This event is full — you and your guest are on the waitlist at **#${position}**.`,
    'Single spots tend to open sooner: tap **RSVP** to drop the +1 and take the next one.',
    ...(plusOnesOpen ? [] : ["+1s are closed right now, so you couldn't add your guest back."]),
  ].join('\n');
}

function describeRejectedPlusOne(
  policy: PlusOnePolicy,
  hasExistingRsvp: boolean,
  timeZone: string,
): string {
  const reason = describeWhyPlusOnesAreClosed(policy, timeZone);

  return hasExistingRsvp
    ? `${reason} **Your own RSVP is unchanged.**`
    : `${reason} You haven't been RSVPed — tap **RSVP** to come on your own.`;
}

function describeRejectedUpgrade(reason: 'no-room' | 'waitlist-ahead', remaining: number): string {
  if (reason === 'waitlist-ahead') {
    return "There's a waitlist ahead of you, so your guest can't take the next spot. **Your own RSVP is unchanged.**";
  }

  const spots = remaining === 1 ? 'only **1** spot' : `only **${remaining}** spots`;
  return `There's ${spots} left, so there's no room for a guest. **Your own RSVP is unchanged** — you're still going solo.`;
}

function applyDecisionToDatabase(
  database: EventDatabase,
  messageId: string,
  userId: string,
  displayName: string,
  decision: RsvpDecision,
): void {
  if (
    decision.kind === 'no-change' ||
    decision.kind === 'reject-upgrade' ||
    decision.kind === 'reject-plus-one'
  ) {
    return;
  }

  const existing = findRsvp(database, messageId, userId);
  const status = decision.kind === 'seat' ? 'confirmed' : 'waitlist';

  if (existing === null) {
    insertRsvp(database, { messageId, userId, displayName, plusOne: decision.plusOne, status });
    return;
  }

  // Only the guest flag ever changes here. Status changes are reconcile's job,
  // and `created_at` is never touched so queue order survives a promotion.
  updateRsvpPlusOne(database, messageId, userId, decision.plusOne);
}

function handleGoingClick(
  context: AppContext,
  messageId: string,
  userId: string,
  displayName: string,
  requestedPlusOne: boolean,
): Omit<RsvpClickOutcome, 'threadId'> {
  const { database } = context;
  const event = findEventByMessageId(database, messageId);

  if (event === null) {
    return { ephemeralMessage: 'This event is no longer being tracked.', promotedUserIds: [] };
  }

  const confirmed = listConfirmedInJoinOrder(database, messageId);
  const { remaining } = summarizeCapacity(event, confirmed);
  const existing = findRsvp(database, messageId, userId);
  const plusOnePolicy = readPlusOnePolicy(event);
  const plusOnesOpen = arePlusOnesOpen(plusOnePolicy, Math.floor(Date.now() / 1000));

  const decision = decideRsvpOutcome({
    existing,
    requestedPlusOne,
    remaining,
    waitlistIsEmpty: listWaitlistInJoinOrder(database, messageId).length === 0,
    plusOnesOpen,
  });

  if (decision.kind === 'reject-plus-one') {
    return {
      ephemeralMessage: describeRejectedPlusOne(
        plusOnePolicy,
        existing !== null,
        context.environment.TZ,
      ),
      promotedUserIds: [],
    };
  }

  if (decision.kind === 'reject-upgrade') {
    return {
      ephemeralMessage: describeRejectedUpgrade(decision.reason, Math.max(0, remaining)),
      promotedUserIds: [],
    };
  }

  applyDecisionToDatabase(database, messageId, userId, displayName, decision);
  const promotedUserIds = reconcileEvent(database, messageId);

  return {
    ephemeralMessage: describeFinalRsvpState(database, messageId, userId, plusOnesOpen),
    promotedUserIds,
  };
}

function handleWithdrawClick(
  context: AppContext,
  messageId: string,
  userId: string,
): Omit<RsvpClickOutcome, 'threadId'> {
  const { database } = context;

  if (findRsvp(database, messageId, userId) === null) {
    return { ephemeralMessage: "You weren't RSVPed to this one.", promotedUserIds: [] };
  }

  // One button covers both states: withdrawing from the waitlist and giving up
  // a confirmed seat are the same intent.
  deleteRsvp(database, messageId, userId);
  const promotedUserIds = reconcileEvent(database, messageId);

  return {
    ephemeralMessage: "You're off the list. Thanks for letting us know.",
    promotedUserIds,
  };
}

/**
 * The whole critical section: read capacity, write the change, reconcile, and
 * re-render, with no other click for this message interleaving. Two people
 * taking the last seat at once is exactly what this prevents.
 */
/**
 * Any click is a free chance to pick up a changed nickname — including a
 * refused one, and including the host's, whose name is also shown on its own
 * in the Host field. For someone not yet on the list there is no row to update;
 * the insert writes their name instead.
 */
function refreshStoredDisplayName(
  context: AppContext,
  event: { message_id: string; host_id: string },
  userId: string,
  displayName: string,
): void {
  updateRsvpDisplayName(context.database, event.message_id, userId, displayName);

  if (event.host_id === userId) {
    updateHostDisplayName(context.database, event.message_id, displayName);
  }
}

async function processRsvpClick(
  context: AppContext,
  messageId: string,
  userId: string,
  displayName: string,
  action: RsvpButtonAction,
): Promise<RsvpClickOutcome> {
  return withMessageLock(messageId, async () => {
    const event = findEventByMessageId(context.database, messageId);

    if (event === null) {
      return {
        ephemeralMessage: 'This event is no longer being tracked.',
        promotedUserIds: [],
        threadId: null,
      };
    }

    if (event.cancelled) {
      return {
        ephemeralMessage: 'This event has been canceled.',
        promotedUserIds: [],
        threadId: event.thread_id,
      };
    }

    if (event.ended) {
      return {
        ephemeralMessage: 'This event has already happened.',
        promotedUserIds: [],
        threadId: event.thread_id,
      };
    }

    refreshStoredDisplayName(context, event, userId, displayName);

    const result =
      action === 'withdraw'
        ? handleWithdrawClick(context, messageId, userId)
        : handleGoingClick(context, messageId, userId, displayName, action === 'going-plus-one');

    await refreshEventPanel(context, messageId);
    return { ...result, threadId: event.thread_id };
  });
}

export async function handleRsvpButton(
  context: AppContext,
  interaction: ButtonInteraction,
): Promise<void> {
  const action = readRsvpButtonAction(interaction.customId);
  if (action === null) {
    return;
  }

  // Acknowledged before any database or network work: Discord invalidates the
  // interaction after three seconds.
  await interaction.deferUpdate();

  const messageId = interaction.message.id;

  try {
    const outcome = await processRsvpClick(
      context,
      messageId,
      interaction.user.id,
      readDisplayName(interaction),
      action,
    );

    await interaction.followUp({
      content: outcome.ephemeralMessage,
      flags: MessageFlags.Ephemeral,
    });

    if (outcome.threadId !== null) {
      await announcePromotedFromWaitlist(context, outcome.threadId, outcome.promotedUserIds);
    }
  } catch (error: unknown) {
    logger.error('rsvp click failed', {
      messageId,
      userId: interaction.user.id,
      action,
      ...describeError(error),
    });

    await interaction
      .followUp({
        content: 'Something went wrong handling that click. Please try again.',
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => undefined);
  }
}
