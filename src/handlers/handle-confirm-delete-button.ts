import { MessageFlags, PermissionFlagsBits, type ButtonInteraction } from 'discord.js';
import type { AppContext } from '../context.js';
import { deleteEventAndRsvps, findEventByMessageId } from '../db/event-queries.js';
import { readMessageIdFromConfirmDeleteButtonId } from '../discord/custom-ids.js';
import { fetchEventThread } from '../discord/refresh-event-panel.js';
import { withMessageLock } from '../lib/message-lock.js';
import { describeError, logger } from '../lib/logger.js';

/**
 * The ephemeral confirmation is only visible to whoever ran the command, so
 * this cannot be clicked by anyone else — but permissions can be taken away
 * between the question and the answer, and a check that is cheap to repeat
 * should not be trusted to a message.
 */
function isServerAdministrator(interaction: ButtonInteraction): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

/**
 * A thread that is already gone is a success, not a failure: an admin who
 * deleted the post by hand in Discord leaves rows behind, and this is the path
 * that clears them.
 */
async function deleteThreadIfPresent(context: AppContext, threadId: string): Promise<void> {
  const thread = await fetchEventThread(context, threadId);
  if (thread === null) {
    return;
  }

  await thread.delete('Event deleted by a server administrator');
}

export async function handleConfirmDeleteButton(
  context: AppContext,
  interaction: ButtonInteraction,
): Promise<void> {
  const messageId = readMessageIdFromConfirmDeleteButtonId(interaction.customId);
  if (messageId === null) {
    return;
  }

  if (!isServerAdministrator(interaction)) {
    await interaction.update({
      content: 'Only a server administrator can delete an event.',
      components: [],
    });
    return;
  }

  const event = findEventByMessageId(context.database, messageId);
  if (event === null) {
    await interaction.update({ content: 'That event has already been deleted.', components: [] });
    return;
  }

  // Acknowledged before anything is destroyed, because the channel this reply
  // lives in is one of the things being destroyed. Once the thread is gone the
  // ephemeral message goes with it, which is its own confirmation.
  await interaction.update({ content: `Deleting **${event.title}**…`, components: [] });

  try {
    // The lock keeps a click that is mid-flight from writing an RSVP into rows
    // that are about to disappear.
    await withMessageLock(messageId, async () => {
      // Discord first: the post is the irreversible part, and if it fails the
      // rows still describe something real.
      await deleteThreadIfPresent(context, event.thread_id);
      deleteEventAndRsvps(context.database, messageId);
    });

    logger.info('event deleted', {
      messageId,
      threadId: event.thread_id,
      deletedBy: interaction.user.id,
    });
  } catch (error: unknown) {
    logger.error('event deletion failed', { messageId, ...describeError(error) });

    // The thread still exists on this path, so a follow-up can still land in it.
    await interaction
      .followUp({
        content:
          'Could not delete that event — nothing was removed. Check that I still have Manage Threads on the forum, then try again.',
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => undefined);
  }
}
