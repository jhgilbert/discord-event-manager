import { MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js';
import type { AppContext } from '../context.js';
import { findEventByMessageId } from '../db/event-queries.js';
import type { EventRow } from '../domain/types.js';
import { readMessageIdFromPlusOneSettingsButtonId } from '../discord/custom-ids.js';
import { isHostOrServerManager } from '../discord/event-permissions.js';
import { buildPlusOneSettingsModal } from '../discord/plus-one-settings-modal.js';

/** The two ways in: the button on a host's reply, and `/event plus-ones`. */
type PlusOneSettingsOpener = ButtonInteraction | ChatInputCommandInteraction;

function findRefusalReason(interaction: PlusOneSettingsOpener, event: EventRow): string | null {
  if (!isHostOrServerManager(interaction, event)) {
    return 'Only the host or a server manager can change the +1 settings.';
  }
  if (event.cancelled) {
    return 'This event was canceled and can no longer be edited.';
  }
  if (event.ended) {
    return 'This event has already happened and can no longer be edited.';
  }
  return null;
}

/**
 * The button only ever appears on a reply the host alone can see, but it can
 * outlive the permission that earned it — so the checks are repeated here, and
 * again on submit. All of them are synchronous reads, because `showModal` has
 * to be the first response.
 */
export async function openPlusOneSettings(
  context: AppContext,
  interaction: PlusOneSettingsOpener,
  event: EventRow | null,
  missingEventMessage: string,
): Promise<void> {
  const refusal = event === null ? missingEventMessage : findRefusalReason(interaction, event);

  if (refusal !== null || event === null) {
    await interaction.reply({ content: refusal ?? missingEventMessage, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.showModal(buildPlusOneSettingsModal(event, context.environment.TZ));
}

export async function handlePlusOneSettingsButton(
  context: AppContext,
  interaction: ButtonInteraction,
): Promise<void> {
  const messageId = readMessageIdFromPlusOneSettingsButtonId(interaction.customId);
  if (messageId === null) {
    return;
  }

  await openPlusOneSettings(
    context,
    interaction,
    findEventByMessageId(context.database, messageId),
    'That event no longer exists.',
  );
}
