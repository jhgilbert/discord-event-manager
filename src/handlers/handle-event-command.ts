import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { AppContext } from '../context.js';
import { EVENT_SUBCOMMANDS } from '../commands/event-command.js';
import { findEventByMessageId, markEventCancelled } from '../db/event-queries.js';
import { buildConfirmDeleteButtonId } from '../discord/custom-ids.js';
import { listConfirmedInJoinOrder, listWaitlistInJoinOrder } from '../db/rsvp-queries.js';
import type { EventRow } from '../domain/types.js';
import { buildEventModal, buildPrefillFromEvent } from '../discord/event-modal.js';
import { isHostOrServerManager } from '../discord/event-permissions.js';
import { announceEventCancelled } from '../discord/announcements.js';
import { lockAndCloseThread, refreshEventPanelNow } from '../discord/refresh-event-panel.js';
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

/**
 * Deliberately stricter than the `ManageGuild` check above. Cancelling is
 * recoverable and tells everyone what happened; deleting destroys the post, its
 * whole discussion and every RSVP with no notice and no undo, so it is held to
 * the server's highest permission. Guild owners hold it implicitly.
 */
function isServerAdministrator(interaction: ChatInputCommandInteraction): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
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

  if (!isHostOrServerManager(interaction, event)) {
    await replyEphemerally(interaction, 'Only the host or a server manager can edit this event.');
    return;
  }

  if (event.cancelled) {
    await replyEphemerally(interaction, 'This event was canceled and can no longer be edited.');
    return;
  }

  if (event.ended) {
    await replyEphemerally(interaction, 'This event has already happened and can no longer be edited.');
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
    await replyEphemerally(interaction, 'This event is already canceled.');
    return;
  }

  if (event.ended) {
    await replyEphemerally(interaction, 'This event has already happened, so there is nothing to cancel.');
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
  await lockAndCloseThread(context, event.thread_id);

  logger.info('event cancelled', {
    messageId: event.message_id,
    cancelledBy: interaction.user.id,
    notified: everyoneToNotify.length,
  });

  await interaction.editReply({
    content: `Canceled. ${everyoneToNotify.length} ${everyoneToNotify.length === 1 ? 'person was' : 'people were'} notified in the thread, and the post is now locked.`,
  });
}

/**
 * Deletion is irreversible and silent, and `/event delete` typed in the wrong
 * post looks exactly like `/event delete` typed in the right one — so it asks
 * first, and the question names what is about to be lost.
 */
async function handleDeleteSubcommand(
  context: AppContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const event = findEventForInteractionChannel(context, interaction);

  if (event === null) {
    await replyEphemerally(interaction, NOT_IN_AN_EVENT_POST);
    return;
  }

  if (!isServerAdministrator(interaction)) {
    await replyEphemerally(
      interaction,
      'Only a server administrator can delete an event. To call one off without erasing it, use `/event cancel`.',
    );
    return;
  }

  const rsvpCount =
    listConfirmedInJoinOrder(context.database, event.message_id).length +
    listWaitlistInJoinOrder(context.database, event.message_id).length;

  const confirmButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildConfirmDeleteButtonId(event.message_id))
      .setLabel('Delete permanently')
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.reply({
    content: [
      `**${event.title}** — this deletes the post, every reply in it, and ${rsvpCount} ${rsvpCount === 1 ? 'RSVP' : 'RSVPs'}.`,
      'Nobody is notified and nothing can be recovered.',
      '',
      'If you meant to call the event off, use `/event cancel` instead — that tells everyone and leaves the post in place.',
    ].join('\n'),
    components: [confirmButton],
    flags: MessageFlags.Ephemeral,
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
      case EVENT_SUBCOMMANDS.delete:
        await handleDeleteSubcommand(context, interaction);
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
