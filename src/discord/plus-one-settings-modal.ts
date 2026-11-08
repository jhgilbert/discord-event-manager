import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  RadioGroupBuilder,
  RadioGroupOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ModalSubmitInteraction,
} from 'discord.js';
import {
  buildPlusOneSettingsButtonId,
  buildPlusOneSettingsModalId,
  PLUS_ONE_MODAL_FIELD_IDS,
} from './custom-ids.js';
import {
  PLUS_ONE_CHOICES,
  readPlusOnePolicy,
  type RawPlusOneForm,
} from '../domain/plus-one-policy.js';
import type { EventRow } from '../domain/types.js';
import { formatPlusOneDate } from './plus-one-copy.js';

/**
 * Its own form rather than a sixth field on the event form, because a modal
 * holds five components and the event form already uses all five.
 */
export function buildPlusOneSettingsButton(messageId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildPlusOneSettingsButtonId(messageId))
      .setLabel('+1 settings')
      .setStyle(ButtonStyle.Secondary),
  );
}

/**
 * A date of 0 ("allowed, no date") prefills as blank, which is exactly what the
 * host would type to get it — so resubmitting an untouched form changes nothing.
 */
function buildPrefill(event: EventRow, timeZone: string): RawPlusOneForm {
  const policy = readPlusOnePolicy(event);

  if (policy.kind === 'not-allowed') {
    return { choice: PLUS_ONE_CHOICES.notAllowed, allowedFrom: '' };
  }

  return {
    choice: PLUS_ONE_CHOICES.allowedFrom,
    allowedFrom: policy.from === 0 ? '' : formatPlusOneDate(policy.from, timeZone),
  };
}

/**
 * Radio buttons rather than a dropdown: two options, both visible at once, and
 * no chance of submitting with nothing chosen.
 */
export function buildPlusOneSettingsModal(event: EventRow, timeZone: string): ModalBuilder {
  const prefill = buildPrefill(event, timeZone);

  const choice = new RadioGroupBuilder()
    .setCustomId(PLUS_ONE_MODAL_FIELD_IDS.choice)
    .setRequired(true)
    .addOptions(
      new RadioGroupOptionBuilder()
        .setLabel('Not allowed')
        .setValue(PLUS_ONE_CHOICES.notAllowed)
        .setDefault(prefill.choice === PLUS_ONE_CHOICES.notAllowed),
      new RadioGroupOptionBuilder()
        .setLabel('Allowed on or after a date')
        .setValue(PLUS_ONE_CHOICES.allowedFrom)
        .setDefault(prefill.choice === PLUS_ONE_CHOICES.allowedFrom),
    );

  const allowedFrom = new TextInputBuilder()
    .setCustomId(PLUS_ONE_MODAL_FIELD_IDS.allowedFrom)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Oct 31  ·  next Friday')
    .setMaxLength(100)
    .setRequired(false);

  // `setValue('')` is rejected by the API, so a blank prefill is omitted.
  if (prefill.allowedFrom !== '') {
    allowedFrom.setValue(prefill.allowedFrom);
  }

  return new ModalBuilder()
    .setCustomId(buildPlusOneSettingsModalId(event.message_id))
    .setTitle('+1 settings')
    .addLabelComponents(
      new LabelBuilder().setLabel('Can attendees bring a guest?').setRadioGroupComponent(choice),
      new LabelBuilder()
        .setLabel('Allowed on or after')
        .setDescription('Only used if +1s are allowed. Leave blank to allow them right away.')
        .setTextInputComponent(allowedFrom),
    );
}

export function readPlusOneFormFromModal(interaction: ModalSubmitInteraction): RawPlusOneForm {
  return {
    choice: interaction.fields.getRadioGroup(PLUS_ONE_MODAL_FIELD_IDS.choice) ?? '',
    allowedFrom: interaction.fields.getTextInputValue(PLUS_ONE_MODAL_FIELD_IDS.allowedFrom),
  };
}
