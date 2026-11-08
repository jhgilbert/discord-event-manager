import { escapeMarkdown, type APIInteractionGuildMember, type GuildMember, type User } from 'discord.js';

/**
 * Names in the panel are plain text, not mentions. A mention inside an embed
 * only renders if the viewer's client already has that user loaded — embeds
 * carry no mention data the way message content does — so on mobile a roster
 * of mentions often shows up as raw user IDs.
 *
 * The cost is that a name is a snapshot: someone who changes their nickname
 * shows the old one until they next click a button on that event.
 */

/** The part of an interaction this reads, so buttons and modals can share it. */
interface InteractionPerson {
  user: User;
  member: GuildMember | APIInteractionGuildMember | null;
}

/**
 * What the server shows for them: nickname, then global display name, then
 * username. Read off the interaction, which carries it for free — no API call.
 */
export function readDisplayName(interaction: InteractionPerson): string {
  const { member, user } = interaction;

  if (member !== null && 'displayName' in member) {
    return member.displayName;
  }

  return member?.nick ?? user.displayName;
}

/**
 * Escaped, so a nickname like `*star*` or `__x__` renders as typed rather than
 * reformatting the roster. A missing name falls back to the mention, which
 * still works on clients that have the user loaded.
 */
export function formatPersonForPanel(userId: string, displayName: string | null): string {
  return displayName === null ? `<@${userId}>` : escapeMarkdown(displayName);
}
