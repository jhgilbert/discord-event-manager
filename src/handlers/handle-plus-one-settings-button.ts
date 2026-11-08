import { MessageFlags, type ButtonInteraction } from 'discord.js';
import type { AppContext } from '../context.js';
import { findEventByMessageId } from '../db/event-queries.js';
import { readMessageIdFromPlusOneSettingsButtonId } from '../discord/custom-ids.js';
import { isHostOrServerManager } from '../discord/event-permissions.js';
import { buildPlusOneSettingsModal } from '../discord/plus-one-settings-modal.js';

async function replyEphemerally(interaction: ButtonInteraction, content: string): Promise<void> {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

/**
 * The button only ever appears on a reply the host alone can see, but it can
 * outlive the permission that earned it — so the checks are repeated here, and
 * again on submit. All of them are synchronous reads, because `showModal` has
 * to be the first response.
 */
export async function handlePlusOneSettingsButton(
  context: AppContext,
  interaction: ButtonInteraction,
): Promise<void> {
  const messageId = readMessageIdFromPlusOneSettingsButtonId(interaction.customId);
  if (messageId === null) {
    return;
  }

  const event = findEventByMessageId(context.database, messageId);

  if (event === null) {
    await replyEphemerally(interaction, 'That event no longer exists.');
    return;
  }

  if (!isHostOrServerManager(interaction, event)) {
    await replyEphemerally(interaction, 'Only the host or a server manager can change the +1 settings.');
    return;
  }

  if (event.cancelled) {
    await replyEphemerally(interaction, 'This event was canceled and can no longer be edited.');
    return;
  }

  await interaction.showModal(buildPlusOneSettingsModal(event, context.environment.TZ));
}
