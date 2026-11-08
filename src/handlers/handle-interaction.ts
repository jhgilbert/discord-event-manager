import type { ButtonInteraction, Interaction } from 'discord.js';
import type { AppContext } from '../context.js';
import { EVENT_COMMAND_NAME } from '../commands/event-command.js';
import {
  LAUNCH_NEW_EVENT_BUTTON_ID,
  readDraftTokenFromButtonId,
  readEventModalTarget,
  readMessageIdFromConfirmDeleteButtonId,
  readMessageIdFromPlusOneSettingsButtonId,
  readMessageIdFromPlusOneSettingsModalId,
  readRsvpButtonAction,
} from '../discord/custom-ids.js';
import { handleConfirmDeleteButton } from './handle-confirm-delete-button.js';
import { handleEventCommand } from './handle-event-command.js';
import { handleEventModalSubmit } from './handle-event-modal-submit.js';
import { handleNewEventButton } from './handle-new-event-button.js';
import { handlePlusOneSettingsButton } from './handle-plus-one-settings-button.js';
import { handlePlusOneSettingsSubmit } from './handle-plus-one-settings-submit.js';
import { handleReopenModalButton } from './handle-reopen-modal-button.js';
import { handleRsvpButton } from './handle-rsvp-button.js';
import { describeError, logger } from '../lib/logger.js';

/**
 * Unrecognised custom IDs fall through silently. That is the intended
 * behaviour for a versioned scheme: after a bump to `v2`, a click on a `v1`
 * button from a bot version no longer deployed should do nothing rather than
 * throw.
 */
async function routeButton(context: AppContext, interaction: ButtonInteraction): Promise<void> {
  if (interaction.customId === LAUNCH_NEW_EVENT_BUTTON_ID) {
    await handleNewEventButton(interaction);
    return;
  }

  if (readDraftTokenFromButtonId(interaction.customId) !== null) {
    await handleReopenModalButton(interaction);
    return;
  }

  if (readMessageIdFromConfirmDeleteButtonId(interaction.customId) !== null) {
    await handleConfirmDeleteButton(context, interaction);
    return;
  }

  if (readMessageIdFromPlusOneSettingsButtonId(interaction.customId) !== null) {
    await handlePlusOneSettingsButton(context, interaction);
    return;
  }

  if (readRsvpButtonAction(interaction.customId) !== null) {
    await handleRsvpButton(context, interaction);
  }
}

export async function handleInteraction(
  context: AppContext,
  interaction: Interaction,
): Promise<void> {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === EVENT_COMMAND_NAME) {
      await handleEventCommand(context, interaction);
      return;
    }

    if (interaction.isButton()) {
      await routeButton(context, interaction);
      return;
    }

    if (interaction.isModalSubmit() && readEventModalTarget(interaction.customId) !== null) {
      await handleEventModalSubmit(context, interaction);
      return;
    }

    if (
      interaction.isModalSubmit() &&
      readMessageIdFromPlusOneSettingsModalId(interaction.customId) !== null
    ) {
      await handlePlusOneSettingsSubmit(context, interaction);
    }
  } catch (error: unknown) {
    // The handlers reply on their own failures; this only catches what escapes
    // them, so that one bad interaction cannot take the process down.
    logger.error('unhandled interaction error', {
      interactionType: interaction.type,
      ...describeError(error),
    });
  }
}
