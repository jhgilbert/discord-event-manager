/**
 * Custom IDs are versioned. Discord stores them inside messages that live
 * forever, so a semantic change to a button means bumping to `v2` here and
 * keeping the `v1` handler around — otherwise every event posted before the
 * deploy stops responding to clicks.
 */
export const CUSTOM_ID_VERSION = 'v1';

export const LAUNCH_NEW_EVENT_BUTTON_ID = `event:${CUSTOM_ID_VERSION}:new`;

export const RSVP_BUTTON_IDS = {
  goingSolo: `rsvp:${CUSTOM_ID_VERSION}:in`,
  goingPlusOne: `rsvp:${CUSTOM_ID_VERSION}:in-plus-one`,
  withdraw: `rsvp:${CUSTOM_ID_VERSION}:out`,
} as const;

export type RsvpButtonAction = 'going-solo' | 'going-plus-one' | 'withdraw';

export function readRsvpButtonAction(customId: string): RsvpButtonAction | null {
  switch (customId) {
    case RSVP_BUTTON_IDS.goingSolo:
      return 'going-solo';
    case RSVP_BUTTON_IDS.goingPlusOne:
      return 'going-plus-one';
    case RSVP_BUTTON_IDS.withdraw:
      return 'withdraw';
    default:
      return null;
  }
}

const REOPEN_MODAL_PREFIX = `event:${CUSTOM_ID_VERSION}:fix:`;

export function buildReopenModalButtonId(draftToken: string): string {
  return `${REOPEN_MODAL_PREFIX}${draftToken}`;
}

export function readDraftTokenFromButtonId(customId: string): string | null {
  return customId.startsWith(REOPEN_MODAL_PREFIX)
    ? customId.slice(REOPEN_MODAL_PREFIX.length)
    : null;
}

const CONFIRM_DELETE_PREFIX = `event:${CUSTOM_ID_VERSION}:delete:`;

/**
 * The event ID travels in the button rather than being looked up from the
 * channel, so the confirmation still refers to the right event even though the
 * thread it was sent in is about to stop existing.
 */
export function buildConfirmDeleteButtonId(messageId: string): string {
  return `${CONFIRM_DELETE_PREFIX}${messageId}`;
}

export function readMessageIdFromConfirmDeleteButtonId(customId: string): string | null {
  return customId.startsWith(CONFIRM_DELETE_PREFIX)
    ? customId.slice(CONFIRM_DELETE_PREFIX.length)
    : null;
}

const CREATE_MODAL_ID = `event:${CUSTOM_ID_VERSION}:create`;
const EDIT_MODAL_PREFIX = `event:${CUSTOM_ID_VERSION}:edit:`;

/** Create and edit share one modal; the ID is what tells the two apart. */
export type EventModalTarget = { mode: 'create' } | { mode: 'edit'; messageId: string };

export function buildEventModalId(target: EventModalTarget): string {
  return target.mode === 'create' ? CREATE_MODAL_ID : `${EDIT_MODAL_PREFIX}${target.messageId}`;
}

export function readEventModalTarget(customId: string): EventModalTarget | null {
  if (customId === CREATE_MODAL_ID) {
    return { mode: 'create' };
  }

  if (customId.startsWith(EDIT_MODAL_PREFIX)) {
    return { mode: 'edit', messageId: customId.slice(EDIT_MODAL_PREFIX.length) };
  }

  return null;
}

/** Field IDs inside the modal, shared by the builder and the submit handler. */
export const EVENT_MODAL_FIELD_IDS = {
  title: 'title',
  when: 'when',
  description: 'description',
  location: 'location',
  capacity: 'capacity',
} as const;

const PLUS_ONE_SETTINGS_BUTTON_PREFIX = `event:${CUSTOM_ID_VERSION}:plus-ones:`;
const PLUS_ONE_SETTINGS_MODAL_PREFIX = `event:${CUSTOM_ID_VERSION}:plus-ones-form:`;

/**
 * The event ID travels in the button because it is shown on the ephemeral
 * reply to create and edit — after create there is no event channel to read it
 * from, since the reply lives in the builder channel.
 */
export function buildPlusOneSettingsButtonId(messageId: string): string {
  return `${PLUS_ONE_SETTINGS_BUTTON_PREFIX}${messageId}`;
}

export function readMessageIdFromPlusOneSettingsButtonId(customId: string): string | null {
  return customId.startsWith(PLUS_ONE_SETTINGS_BUTTON_PREFIX)
    ? customId.slice(PLUS_ONE_SETTINGS_BUTTON_PREFIX.length)
    : null;
}

export function buildPlusOneSettingsModalId(messageId: string): string {
  return `${PLUS_ONE_SETTINGS_MODAL_PREFIX}${messageId}`;
}

export function readMessageIdFromPlusOneSettingsModalId(customId: string): string | null {
  return customId.startsWith(PLUS_ONE_SETTINGS_MODAL_PREFIX)
    ? customId.slice(PLUS_ONE_SETTINGS_MODAL_PREFIX.length)
    : null;
}

export const PLUS_ONE_MODAL_FIELD_IDS = {
  choice: 'plus-one-choice',
  allowedFrom: 'plus-one-allowed-from',
} as const;
