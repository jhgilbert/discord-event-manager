import {
  escapeMarkdown,
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { AppContext } from '../context.js';
import { RESERVED_SEAT_NAME_OPTION } from '../commands/event-command.js';
import {
  deleteRsvp,
  findRsvp,
  insertRsvp,
  listConfirmedInJoinOrder,
  listReservedSeats,
  listWaitlistInJoinOrder,
} from '../db/rsvp-queries.js';
import { summarizeCapacity } from '../domain/capacity.js';
import { reconcileEvent } from '../domain/reconcile.js';
import {
  buildReservedSeatKey,
  isReservedSeat,
  parseReservedName,
} from '../domain/reserved-seats.js';
import { decideRsvpOutcome } from '../domain/rsvp-decision.js';
import type { EventRow, RsvpRow } from '../domain/types.js';
import { announcePromotedFromWaitlist, postNoticeInEventThread } from '../discord/announcements.js';
import { isHostOrServerManager } from '../discord/event-permissions.js';
import { findEventForChannel, NOT_IN_AN_EVENT_POST } from '../discord/event-post-lookup.js';
import { refreshEventPanel } from '../discord/refresh-event-panel.js';
import { withMessageLock } from '../lib/message-lock.js';
import { logger } from '../lib/logger.js';

/**
 * `/event reserve-seat` and `/event release-seat`. See domain/reserved-seats.ts
 * for how a reserved seat is stored and why.
 */

interface SeatOutcome {
  message: string;
  /** Posted in the thread without pinging anyone; null when nothing changed. */
  notice: string | null;
  promoted: RsvpRow[];
  threadId: string | null;
}

function refuse(message: string): SeatOutcome {
  return { message, notice: null, promoted: [], threadId: null };
}

/** The same people who can edit the event, re-checked inside the lock. */
function findRefusalReason(interaction: ChatInputCommandInteraction, event: EventRow | null): string | null {
  if (event === null) {
    return NOT_IN_AN_EVENT_POST;
  }
  if (!isHostOrServerManager(interaction, event)) {
    return 'Only the host or a server manager can reserve or release seats on this event.';
  }
  if (event.cancelled) {
    return 'This event was canceled.';
  }
  if (event.ended) {
    return 'This event has already happened.';
  }
  return null;
}

function findWaitlistPosition(context: AppContext, messageId: string, userId: string): number {
  const index = listWaitlistInJoinOrder(context.database, messageId).findIndex(
    (rsvp) => rsvp.user_id === userId,
  );
  return index + 1;
}

/**
 * Seated or queued exactly as a member clicking **RSVP** would be: while a
 * waitlist exists, nobody — a host's guest included — jumps it.
 */
function reserveSeat(
  context: AppContext,
  interaction: ChatInputCommandInteraction,
  event: EventRow,
  name: string,
): SeatOutcome {
  const { database } = context;
  const messageId = event.message_id;
  const key = buildReservedSeatKey(name);
  const shownName = escapeMarkdown(name);

  const existing = findRsvp(database, messageId, key);
  if (existing !== null) {
    const existingName = escapeMarkdown(existing.display_name ?? name);
    return refuse(
      `There's already a seat reserved for **${existingName}** on this event. If this is someone else with the same name, add an initial — like "${existingName} B."`,
    );
  }

  const decision = decideRsvpOutcome({
    existing: null,
    requestedPlusOne: false,
    remaining: summarizeCapacity(event, listConfirmedInJoinOrder(database, messageId)).remaining,
    waitlistIsEmpty: listWaitlistInJoinOrder(database, messageId).length === 0,
    // A reserved seat is one person, never a guest, so the +1 rule is not asked.
    plusOnesOpen: true,
  });

  insertRsvp(database, {
    messageId,
    userId: key,
    displayName: name,
    plusOne: false,
    status: decision.kind === 'seat' ? 'confirmed' : 'waitlist',
    reservedBy: interaction.user.id,
  });

  // Read back after reconcile, for the same reason the RSVP button does.
  const promoted = reconcileEvent(database, messageId);
  const seat = findRsvp(database, messageId, key);
  const reserver = `<@${interaction.user.id}>`;

  if (seat?.status === 'confirmed') {
    return {
      message: `Seat reserved for **${shownName}**. They're on the Going list.`,
      notice: `${reserver} reserved a seat for **${shownName}**.`,
      promoted,
      threadId: event.thread_id,
    };
  }

  const position = findWaitlistPosition(context, messageId, key);
  return {
    message: `This event is full, so **${shownName}** is on the waitlist at **#${position}**. You'll be pinged in the thread if a spot opens up for them.`,
    notice: `${reserver} added **${shownName}** to the waitlist.`,
    promoted,
    threadId: event.thread_id,
  };
}

function describeReservedNames(seats: RsvpRow[]): string {
  return seats.length === 0
    ? 'There are no reserved seats on this event.'
    : `Reserved seats on this event: ${seats.map((seat) => `**${escapeMarkdown(seat.display_name ?? '')}**`).join(', ')}.`;
}

/** Freeing the seat is a withdrawal like any other, so the queue moves up. */
function releaseSeat(
  context: AppContext,
  interaction: ChatInputCommandInteraction,
  event: EventRow,
  name: string,
): SeatOutcome {
  const { database } = context;
  const messageId = event.message_id;
  const seat = findRsvp(database, messageId, buildReservedSeatKey(name));

  if (seat === null || !isReservedSeat(seat)) {
    return refuse(
      `No seat is reserved for **${escapeMarkdown(name)}**. ${describeReservedNames(listReservedSeats(database, messageId))}`,
    );
  }

  deleteRsvp(database, messageId, seat.user_id);
  const promoted = reconcileEvent(database, messageId);

  const shownName = escapeMarkdown(seat.display_name ?? name);
  const what = seat.status === 'confirmed' ? 'seat' : 'waitlist spot';

  return {
    message: `Released **${shownName}**'s ${what}.`,
    notice: `<@${interaction.user.id}> released **${shownName}**'s ${what}.`,
    promoted,
    threadId: event.thread_id,
  };
}

const SEAT_ACTIONS = { reserve: reserveSeat, release: releaseSeat } as const;
type SeatActionName = keyof typeof SEAT_ACTIONS;

async function runSeatCommand(
  context: AppContext,
  interaction: ChatInputCommandInteraction,
  actionName: SeatActionName,
): Promise<void> {
  // The thread ID is the event's key; see event-post-lookup.ts.
  const messageId = interaction.channelId;
  const parsed = parseReservedName(interaction.options.getString(RESERVED_SEAT_NAME_OPTION, true));

  if (!parsed.ok) {
    await interaction.reply({ content: parsed.problem, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const outcome = await withMessageLock(messageId, async (): Promise<SeatOutcome> => {
    const event = findEventForChannel(context, messageId);
    const refusal = findRefusalReason(interaction, event);

    if (refusal !== null || event === null) {
      return refuse(refusal ?? NOT_IN_AN_EVENT_POST);
    }

    const result = SEAT_ACTIONS[actionName](context, interaction, event, parsed.name);
    if (result.notice !== null) {
      await refreshEventPanel(context, messageId);
    }
    return result;
  });

  await interaction.editReply({ content: outcome.message });

  if (outcome.threadId === null || outcome.notice === null) {
    return;
  }

  logger.info('reserved seat changed', {
    messageId,
    by: interaction.user.id,
    action: actionName,
  });

  // The change first, then its consequences, as with an edit.
  const { notice } = outcome;
  await postNoticeInEventThread(context, outcome.threadId, () => notice, []);
  await announcePromotedFromWaitlist(context, outcome.threadId, outcome.promoted);
}

export async function handleReserveSeatSubcommand(
  context: AppContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await runSeatCommand(context, interaction, 'reserve');
}

export async function handleReleaseSeatSubcommand(
  context: AppContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await runSeatCommand(context, interaction, 'release');
}

/** Discord shows at most 25 suggestions. */
const MAX_SUGGESTIONS = 25;

/**
 * Suggests only to people who could release a seat, so the names on someone
 * else's event are not offered to everyone who types the command.
 */
export async function suggestReservedNames(
  context: AppContext,
  interaction: AutocompleteInteraction,
): Promise<void> {
  const event = findEventForChannel(context, interaction.channelId);

  if (event === null || !isHostOrServerManager(interaction, event)) {
    await interaction.respond([]);
    return;
  }

  const typed = interaction.options.getFocused().toLocaleLowerCase();
  const names = listReservedSeats(context.database, event.message_id)
    .map((seat) => seat.display_name ?? '')
    .filter((name) => name !== '' && name.toLocaleLowerCase().includes(typed))
    .slice(0, MAX_SUGGESTIONS);

  await interaction.respond(names.map((name) => ({ name, value: name })));
}
