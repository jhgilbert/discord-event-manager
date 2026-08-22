import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Message,
  type TextChannel,
} from 'discord.js';
import { LAUNCH_NEW_EVENT_BUTTON_ID } from './custom-ids.js';
import { describeError, logger } from '../lib/logger.js';

/**
 * A modal can only open as the immediate reply to another interaction, so
 * something must be clickable first. A persistent pinned button is the primary
 * trigger: no syntax to remember, and discoverable by anyone who wanders into
 * the channel. `/event create` is the same handler behind a command.
 */
function buildNewEventPanelPayload() {
  const embed = new EmbedBuilder()
    .setTitle('Create an event')
    .setDescription(
      [
        'Click **New event** to open the form. Your event is posted to the events forum with RSVP buttons, a live roster and a waitlist.',
        '',
        '· `/event edit` — change the details (run it inside your event post)',
        '· `/event cancel` — call it off and notify everyone who RSVPed',
      ].join('\n'),
    )
    .setColor(0x5865f2);

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(LAUNCH_NEW_EVENT_BUTTON_ID)
      .setLabel('New event')
      .setEmoji('📅')
      .setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [buttons] };
}

function isOurNewEventPanel(message: Message, botUserId: string): boolean {
  if (message.author.id !== botUserId) {
    return false;
  }

  // The versioned custom ID is what identifies the panel, so a `v2` panel would
  // be posted fresh rather than mistaken for this one.
  return message.components.some(
    (row) =>
      'components' in row &&
      row.components.some(
        (component) =>
          'customId' in component && component.customId === LAUNCH_NEW_EVENT_BUTTON_ID,
      ),
  );
}

async function findExistingNewEventPanel(
  channel: TextChannel,
  botUserId: string,
): Promise<Message | null> {
  const recentMessages = await channel.messages.fetch({ limit: 50 });
  return recentMessages.find((message) => isOurNewEventPanel(message, botUserId)) ?? null;
}

/**
 * Runs on every boot and is idempotent: it reuses the existing panel if one is
 * still in the channel, so restarts and redeploys do not litter the channel
 * with duplicates.
 */
export async function ensureNewEventPanelExists(
  channel: TextChannel,
  botUserId: string,
): Promise<void> {
  const existing = await findExistingNewEventPanel(channel, botUserId);

  if (existing !== null) {
    // Refreshed so copy changes ship without the admin deleting the old panel.
    await existing.edit(buildNewEventPanelPayload());
    logger.info('reused existing new event panel', { messageId: existing.id });
    return;
  }

  const posted = await channel.send(buildNewEventPanelPayload());

  // Pinning needs the Pin Messages permission, which was split out of Manage
  // Messages in February 2026. The panel still works unpinned, so a failure
  // here is a warning rather than a crash.
  await posted.pin().catch((error: unknown) => {
    logger.warn('could not pin the new event panel; grant Pin Messages to fix', {
      ...describeError(error),
    });
  });

  logger.info('posted new event panel', { messageId: posted.id });
}
