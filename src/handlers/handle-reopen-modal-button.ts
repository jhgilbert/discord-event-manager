import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { readDraftTokenFromButtonId } from '../discord/custom-ids.js';
import { buildEventModal } from '../discord/event-modal.js';
import { takeDraft } from '../lib/draft-store.js';

/**
 * The other half of the validation-recovery path: reopens the same modal with
 * the host's rejected answers still in the fields, so a typo in the date costs
 * one correction rather than retyping a 4000-character description.
 */
export async function handleReopenModalButton(interaction: ButtonInteraction): Promise<void> {
  const draftToken = readDraftTokenFromButtonId(interaction.customId);
  if (draftToken === null) {
    return;
  }

  const draft = takeDraft(draftToken, interaction.user.id);

  if (draft === null) {
    await interaction.reply({
      content: 'That form expired. Start a new one with the **New event** button.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(buildEventModal(draft.target, draft.values));
}
