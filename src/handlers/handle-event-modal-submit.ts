import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { AppContext } from '../context.js';
import {
  clearReminderSent,
  findEventByMessageId,
  updateEventDetails,
} from '../db/event-queries.js';
import { parseEventForm, type RawEventForm } from '../domain/event-form.js';
import { reconcileEvent } from '../domain/reconcile.js';
import type { EventDetails } from '../domain/types.js';
import {
  buildReopenModalButtonId,
  readEventModalTarget,
  type EventModalTarget,
} from '../discord/custom-ids.js';
import { readEventFormFromModal } from '../discord/event-modal.js';
import { publishNewEvent } from '../discord/publish-event.js';
import { refreshEventPanel } from '../discord/refresh-event-panel.js';
import { announcePromotedFromWaitlist } from '../discord/announcements.js';
import { saveDraft } from '../lib/draft-store.js';
import { withMessageLock } from '../lib/message-lock.js';
import { describeError, logger } from '../lib/logger.js';

/**
 * A modal submission cannot be answered with another modal, so a rejected form
 * becomes an ephemeral list of problems plus a button that reopens the modal
 * with everything they typed still in it.
 */
async function replyWithFormProblems(
  interaction: ModalSubmitInteraction,
  target: EventModalTarget,
  submitted: RawEventForm,
  problems: string[],
): Promise<void> {
  const draftToken = saveDraft(interaction.user.id, target, submitted);

  const retryButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildReopenModalButtonId(draftToken))
      .setLabel('Fix it')
      .setStyle(ButtonStyle.Primary),
  );

  await interaction.editReply({
    content: [
      "That didn't quite work:",
      ...problems.map((problem) => `· ${problem}`),
      '',
      'Nothing was lost — **Fix it** reopens the form with your answers.',
    ].join('\n'),
    components: [retryButton],
  });
}

async function createEventFromForm(
  context: AppContext,
  interaction: ModalSubmitInteraction,
  details: EventDetails,
): Promise<void> {
  const guildId = interaction.guildId;
  if (guildId === null) {
    await interaction.editReply({ content: 'Events can only be created inside a server.' });
    return;
  }

  const published = await publishNewEvent(context, interaction.user.id, guildId, details);

  logger.info('event created', {
    messageId: published.messageId,
    hostId: interaction.user.id,
    startsAt: details.startsAt,
    capacity: details.capacity,
  });

  await interaction.editReply({
    content: `Posted: ${published.thread.url}`,
    components: [],
  });
}

/**
 * Renaming on a title change is fine — thread renames are limited to 2 per 10
 * minutes, which only rules out using them for live counts.
 */
async function renameThreadIfTitleChanged(
  context: AppContext,
  threadId: string,
  previousTitle: string,
  nextTitle: string,
): Promise<void> {
  if (previousTitle === nextTitle) {
    return;
  }

  const thread = await context.client.channels.fetch(threadId).catch(() => null);
  if (thread === null || !thread.isThread()) {
    return;
  }

  await thread.setName(nextTitle).catch((error: unknown) => {
    logger.warn('could not rename event thread', { threadId, ...describeError(error) });
  });
}

async function applyEventEdit(
  context: AppContext,
  interaction: ModalSubmitInteraction,
  messageId: string,
  details: EventDetails,
): Promise<void> {
  const outcome = await withMessageLock(messageId, async () => {
    const event = findEventByMessageId(context.database, messageId);

    if (event === null) {
      return { message: 'That event no longer exists.', promotedUserIds: [], threadId: null };
    }

    if (event.host_id !== interaction.user.id) {
      return { message: 'Only the host can edit this event.', promotedUserIds: [], threadId: null };
    }

    if (event.cancelled) {
      return { message: 'This event was cancelled and can no longer be edited.', promotedUserIds: [], threadId: null };
    }

    updateEventDetails(context.database, messageId, details);

    // Moving the event later should let the reminder fire again for the new
    // time, even if one already went out for the old one.
    if (event.starts_at !== details.startsAt) {
      clearReminderSent(context.database, messageId);
    }

    // Raising capacity needs no special case: reconcile is called after every
    // mutation and simply finds more room this time.
    const promotedUserIds = reconcileEvent(context.database, messageId);

    await renameThreadIfTitleChanged(context, event.thread_id, event.title, details.title);
    await refreshEventPanel(context, messageId);

    return { message: 'Event updated.', promotedUserIds, threadId: event.thread_id };
  });

  await interaction.editReply({ content: outcome.message, components: [] });

  if (outcome.threadId !== null) {
    await announcePromotedFromWaitlist(context, outcome.threadId, outcome.promotedUserIds);
  }
}

export async function handleEventModalSubmit(
  context: AppContext,
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const target = readEventModalTarget(interaction.customId);
  if (target === null) {
    return;
  }

  // Creating a forum post can outrun the three-second window, so the reply is
  // deferred first. (Only *showing* a modal cannot be deferred.)
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const submitted = readEventFormFromModal(interaction);
  const parsed = parseEventForm(submitted);

  if (!parsed.ok) {
    await replyWithFormProblems(interaction, target, submitted, parsed.problems);
    return;
  }

  try {
    if (target.mode === 'create') {
      await createEventFromForm(context, interaction, parsed.details);
    } else {
      await applyEventEdit(context, interaction, target.messageId, parsed.details);
    }
  } catch (error: unknown) {
    logger.error('event modal submission failed', {
      mode: target.mode,
      userId: interaction.user.id,
      ...describeError(error),
    });

    await interaction
      .editReply({ content: 'Something went wrong saving that event. Please try again.', components: [] })
      .catch(() => undefined);
  }
}
