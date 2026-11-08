import { PermissionFlagsBits, type PermissionsBitField } from 'discord.js';
import type { EventRow } from '../domain/types.js';

/**
 * The only part of an interaction these checks read, so one function can serve
 * both a slash command and the modal it opens — two different interaction types
 * that must never disagree about who is allowed to do what.
 */
interface ActingMember {
  user: { id: string };
  memberPermissions: Readonly<PermissionsBitField> | null;
}

/**
 * Edit and cancel. A server manager can fix or call off an event whose host has
 * gone quiet or left the server; ordinary members cannot touch someone else's.
 *
 * Deliberately looser than the `Administrator` check that guards deletion: both
 * of these are recoverable and visible, where deletion is neither.
 *
 * `has` treats Administrator as holding every permission, so admins and the
 * guild owner pass here without needing to be named separately.
 */
export function isHostOrServerManager(interaction: ActingMember, event: EventRow): boolean {
  return event.host_id === interaction.user.id || isServerManager(interaction);
}

/**
 * `/event reload`. Moderator housekeeping, so being the host is not enough on
 * its own — though a host who is also a server manager passes.
 */
export function isServerManager(interaction: ActingMember): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}
