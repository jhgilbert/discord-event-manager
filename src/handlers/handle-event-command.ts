import {
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { AppContext } from '../context.js';
import { EVENT_SUBCOMMANDS } from '../commands/event-command.js';
import { findEventByMessageId, markEventCancelled } from '../db/event-queries.js';
import { listConfirmedInJoinOrder, listWaitlistInJoinOrder } from '../db/rsvp-queries.js';
import type { EventRow } from '../domain/types.js';
import { buildEventModal, buildPrefillFromEvent } from '../discord/event-modal.js';
import { announceEventCancelled } from '../discord/announcements.js';
import { fetchEventThread, refreshEventPanelNow } from '../discord/refresh-event-panel.js';
import { withMessageLock } from '../lib/message-lock.js';
import { describeError, logger } from '../lib/logger.js';

/**
 * `edit` and `cancel` are run inside the event's own post, so the channel the
 * command came from *is* the event: for a forum post the thread ID, the starter
 * message ID and our primary key are all the same snowflake.
 */
function findEventForInteractionChannel(
  context: AppContext,
  interaction: ChatInputCommandInteraction,
): EventRow | null {
  return findEventByMessageId(context.database, interaction.channelId);
}

function isHostOrServerManager(
  interaction: ChatInputCommandInteraction,
  event: EventRow,
): boolean {
  if (event.host_id === interaction.user.id) {
    return true;
  }

  // A server manager can clean up after a host who left; ordinary members
  // cannot touch someone else's event.
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

const NOT_IN_AN_EVENT_POST =
  "Run this inside the event's own post in the events forum — that's how I know which event you mean.";

async function replyEphemerally(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function handleCreateSubcommand(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.showModal(buildEventModal({ mode: 'create' }));
}

/**
 * Every check here is a synchronous SQLite read, which matters: `showModal`
 * must be the first response to the interaction, so nothing before it may await
 * a network round trip.
 */
async function handleEditSubcommand(
  context: AppContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const event = findEventForInteractionChannel(context, interaction);

  if (event === null) {
    await replyEphemerally(interaction, NOT_IN_AN_EVENT_POST);
    return;
  }

  if (event.host_id !== interaction.user.id) {
    await replyEphemerally(interaction, 'Only the host can edit this event.');
    return;
  }

  if (event.cancelled) {
    await replyEphemerally(interaction, 'This event was cancelled and can no longer be edited.');
    return;
  }

  // The same modal as create, prefilled from the database — built by one
  // function so the two forms cannot drift apart.
  await interaction.showModal(
    buildEventModal(
      { mode: 'edit', messageId: event.message_id },
      buildPrefillFromEvent(event, context.environment.TZ),
    ),
  );
}

async function lockAndArchiveThread(context: AppContext, threadId: string): Promise<void> {
  const thread = await fetchEventThread(context, threadId);
  if (thread === null) {
    return;
  }

  try {
    // Locked so the post stops collecting replies, then archived so it drops
    // out of the active list. Locking first: archiving can require an
    // unarchive round trip to make further changes.
    await thread.setLocked(true);
    await thread.setArchived(true);
  } catch (error: unknown) {
    logger.warn('could not lock or archive the cancelled event thread', {
      threadId,
      ...describeError(error),
    });
  }
}

async function handleCancelSubcommand(
  context: AppContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const event = findEventForInteractionChannel(context, interaction);

  if (event === null) {
    await replyEphemerally(interaction, NOT_IN_AN_EVENT_POST);
    return;
  }

  if (!isHostOrServerManager(interaction, event)) {
    await replyEphemerally(interaction, 'Only the host or a server manager can cancel this event.');
    return;
  }

  if (event.cancelled) {
    await replyEphemerally(interaction, 'This event is already cancelled.');
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const everyoneToNotify = await withMessageLock(event.message_id, async () => {
    // Everyone who was counting on it, queued or seated — a waitlisted member
    // is still holding the evening open.
    const notify = [
      ...listConfirmedInJoinOrder(context.database, event.message_id),
      ...listWaitlistInJoinOrder(context.database, event.message_id),
    ].map((rsvp) => rsvp.user_id);

    markEventCancelled(context.database, event.message_id);

    // Immediate rather than debounced: the panel has to show the cancelled
    // state before the thread is archived underneath it.
    await refreshEventPanelNow(context, event.message_id);
    return notify;
  });

  await announceEventCancelled(context, event.thread_id, everyoneToNotify, event.title);
  await lockAndArchiveThread(context, event.thread_id);

  logger.info('event cancelled', {
    messageId: event.message_id,
    cancelledBy: interaction.user.id,
    notified: everyoneToNotify.length,
  });

  await interaction.editReply({
    content: `Cancelled. ${everyoneToNotify.length} ${everyoneToNotify.length === 1 ? 'person was' : 'people were'} notified in the thread, and the post is now locked.`,
  });
}

export async function handleEventCommand(
  context: AppContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  try {
    switch (subcommand) {
      case EVENT_SUBCOMMANDS.create:
        await handleCreateSubcommand(interaction);
        return;
      case EVENT_SUBCOMMANDS.edit:
        await handleEditSubcommand(context, interaction);
        return;
      case EVENT_SUBCOMMANDS.cancel:
        await handleCancelSubcommand(context, interaction);
        return;
      default:
        await replyEphemerally(interaction, 'Unknown subcommand.');
    }
  } catch (error: unknown) {
    logger.error('event command failed', {
      subcommand,
      userId: interaction.user.id,
      ...describeError(error),
    });

    const failureMessage = 'Something went wrong running that command. Please try again.';

    await (interaction.deferred || interaction.replied
      ? interaction.editReply({ content: failureMessage })
      : interaction.reply({ content: failureMessage, flags: MessageFlags.Ephemeral })
    ).catch(() => undefined);
  }
}
