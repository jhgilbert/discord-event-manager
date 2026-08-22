import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ModalSubmitInteraction,
} from 'discord.js';
import {
  buildEventModalId,
  EVENT_MODAL_FIELD_IDS,
  type EventModalTarget,
} from './custom-ids.js';
import {
  DESCRIPTION_MAX_LENGTH,
  LOCATION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  type RawEventForm,
} from '../domain/event-form.js';
import type { EventRow } from '../domain/types.js';

/**
 * Five components is the modal's hard cap, so these five fields are the whole
 * form. Anything else has to be inferred or defaulted.
 */
function buildFieldRow(input: TextInputBuilder): ActionRowBuilder<TextInputBuilder> {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

/** `setValue('')` is rejected by the API, so blank prefills must be omitted. */
function applyPrefill(input: TextInputBuilder, value: string | undefined): TextInputBuilder {
  return value !== undefined && value !== '' ? input.setValue(value) : input;
}

/**
 * One builder for both create and edit. Building them separately is how the two
 * forms drift apart — a field added to create silently missing from edit.
 */
export function buildEventModal(
  target: EventModalTarget,
  prefill: Partial<RawEventForm> = {},
): ModalBuilder {
  const title = applyPrefill(
    new TextInputBuilder()
      .setCustomId(EVENT_MODAL_FIELD_IDS.title)
      .setLabel('Title')
      .setPlaceholder('Board game night')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(TITLE_MAX_LENGTH)
      .setRequired(true),
    prefill.title,
  );

  const when = applyPrefill(
    new TextInputBuilder()
      .setCustomId(EVENT_MODAL_FIELD_IDS.when)
      .setLabel('Date and time')
      .setPlaceholder('Friday 7pm  ·  next Tuesday 18:30  ·  March 3 at noon')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(100)
      .setRequired(true),
    prefill.when,
  );

  const description = applyPrefill(
    new TextInputBuilder()
      .setCustomId(EVENT_MODAL_FIELD_IDS.description)
      .setLabel('Description')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(DESCRIPTION_MAX_LENGTH)
      .setRequired(false),
    prefill.description,
  );

  const location = applyPrefill(
    new TextInputBuilder()
      .setCustomId(EVENT_MODAL_FIELD_IDS.location)
      .setLabel('Location (optional)')
      .setPlaceholder('The Rose & Crown, or a video call link')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(LOCATION_MAX_LENGTH)
      .setRequired(false),
    prefill.location,
  );

  const capacity = applyPrefill(
    new TextInputBuilder()
      .setCustomId(EVENT_MODAL_FIELD_IDS.capacity)
      .setLabel('Capacity (total people, guests included)')
      .setPlaceholder('20')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(5)
      .setRequired(true),
    prefill.capacity,
  );

  return new ModalBuilder()
    .setCustomId(buildEventModalId(target))
    .setTitle(target.mode === 'create' ? 'New event' : 'Edit event')
    .addComponents(
      buildFieldRow(title),
      buildFieldRow(when),
      buildFieldRow(description),
      buildFieldRow(location),
      buildFieldRow(capacity),
    );
}

export function readEventFormFromModal(interaction: ModalSubmitInteraction): RawEventForm {
  const read = (fieldId: string) => interaction.fields.getTextInputValue(fieldId);

  return {
    title: read(EVENT_MODAL_FIELD_IDS.title),
    when: read(EVENT_MODAL_FIELD_IDS.when),
    description: read(EVENT_MODAL_FIELD_IDS.description),
    location: read(EVENT_MODAL_FIELD_IDS.location),
    capacity: read(EVENT_MODAL_FIELD_IDS.capacity),
  };
}

/**
 * The stored start time is a unix stamp, but the modal field is free text. Round
 * -tripping it through a readable local string means an editing host sees
 * something they could have typed themselves.
 */
function formatStartsAtForEditing(startsAt: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
    hour12: false,
  }).format(new Date(startsAt * 1000));
}

export function buildPrefillFromEvent(event: EventRow, timeZone: string): RawEventForm {
  return {
    title: event.title,
    when: formatStartsAtForEditing(event.starts_at, timeZone),
    description: event.description ?? '',
    location: event.location ?? '',
    capacity: String(event.capacity),
  };
}
