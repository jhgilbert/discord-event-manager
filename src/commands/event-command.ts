import { InteractionContextType, SlashCommandBuilder } from 'discord.js';

export const EVENT_COMMAND_NAME = 'event';

export const EVENT_SUBCOMMANDS = {
  create: 'create',
  edit: 'edit',
  cancel: 'cancel',
  delete: 'delete',
} as const;

/**
 * `create` takes no options on purpose: a command with options cannot open a
 * modal as its first response, and the modal is the form.
 *
 * Note that slash commands cannot be typed at a forum channel's root — there is
 * no composer there — so `create` is used from the launcher channel, while
 * `edit` and `cancel` are used inside an event's own post.
 */
export function buildEventCommandDefinition() {
  return new SlashCommandBuilder()
    .setName(EVENT_COMMAND_NAME)
    .setDescription('Create and manage events')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((subcommand) =>
      subcommand.setName(EVENT_SUBCOMMANDS.create).setDescription('Open the new event form'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName(EVENT_SUBCOMMANDS.edit)
        .setDescription("Edit this event (run inside the event's post)"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName(EVENT_SUBCOMMANDS.cancel)
        .setDescription("Cancel this event and notify attendees (run inside the event's post)"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName(EVENT_SUBCOMMANDS.delete)
        .setDescription('Admin only: erase this event and its post entirely, with no notice'),
    )
    .toJSON();
}
