import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { RESERVED_NAME_MAX_LENGTH } from '../domain/reserved-seats.js';

export const EVENT_COMMAND_NAME = 'event';

export const EVENT_SUBCOMMANDS = {
  create: 'create',
  edit: 'edit',
  plusOnes: 'plus-ones',
  cancel: 'cancel',
  delete: 'delete',
  reload: 'reload',
  reserveSeat: 'reserve-seat',
  releaseSeat: 'release-seat',
} as const;

/**
 * Named `for` so the command reads as a sentence where it is typed:
 * `/event reserve-seat for: Levi`.
 */
export const RESERVED_SEAT_NAME_OPTION = 'for';

/**
 * `create` takes no options on purpose: a command with options cannot open a
 * modal as its first response, and the modal is the form.
 *
 * Note that slash commands cannot be typed at a forum channel's root — there is
 * no composer there — so `create` is used from the event builder channel, while
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
        .setName(EVENT_SUBCOMMANDS.plusOnes)
        .setDescription("Choose whether attendees can bring a guest (run inside the event's post)"),
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
    .addSubcommand((subcommand) =>
      subcommand
        .setName(EVENT_SUBCOMMANDS.reload)
        .setDescription("Admin only: refresh everyone's names and redraw this post"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName(EVENT_SUBCOMMANDS.reserveSeat)
        .setDescription('Hold a seat for someone who is not on Discord (run inside the event post)')
        .addStringOption((option) =>
          option
            .setName(RESERVED_SEAT_NAME_OPTION)
            .setDescription('Their name, as it should appear on the post')
            .setRequired(true)
            .setMaxLength(RESERVED_NAME_MAX_LENGTH),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName(EVENT_SUBCOMMANDS.releaseSeat)
        .setDescription('Give up a seat you reserved for someone (run inside the event post)')
        .addStringOption((option) =>
          option
            .setName(RESERVED_SEAT_NAME_OPTION)
            .setDescription('Who the seat was reserved for')
            .setRequired(true)
            .setMaxLength(RESERVED_NAME_MAX_LENGTH)
            // Offers the names reserved on this post, so releasing one never
            // depends on retyping it exactly.
            .setAutocomplete(true),
        ),
    )
    .toJSON();
}
