import type { ButtonInteraction } from 'discord.js';
import { buildEventModal } from '../discord/event-modal.js';

/**
 * `showModal` must be the very first response to the interaction — there is
 * nothing to defer and nothing to await beforehand. Any permission check that
 * needed a fetch would blow the three-second budget, which is one reason access
 * is governed by channel permissions on the event builder channel instead.
 */
export async function handleNewEventButton(interaction: ButtonInteraction): Promise<void> {
  await interaction.showModal(buildEventModal({ mode: 'create' }));
}
