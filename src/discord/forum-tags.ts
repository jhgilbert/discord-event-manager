import type { ForumChannel, ThreadChannel } from 'discord.js';
import { logger } from '../lib/logger.js';

/**
 * Tags are the only event state visible in the forum list without opening a
 * post. Thread names cannot carry live counts — renames are limited to 2 per
 * 10 minutes — so tags do that job instead.
 */
export const EVENT_STATE_TAG_NAMES = ['Open', 'Full', 'Cancelled'] as const;
export type EventStateTagName = (typeof EVENT_STATE_TAG_NAMES)[number];

function findTagIdByName(forum: ForumChannel, name: string): string | null {
  const tag = forum.availableTags.find(
    (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
  );
  return tag?.id ?? null;
}

/**
 * Applying tags requires them to exist on the forum, which is the admin's job
 * during setup. Reporting the gap once at boot beats a silent no-op on every
 * RSVP.
 */
export function warnAboutMissingStateTags(forum: ForumChannel): void {
  const missing = EVENT_STATE_TAG_NAMES.filter((name) => findTagIdByName(forum, name) === null);

  if (missing.length > 0) {
    logger.warn('forum is missing event state tags; state will not show in the forum list', {
      forumChannelId: forum.id,
      missingTags: missing,
    });
  }
}

export function chooseStateTagName(event: {
  cancelled: number;
  isFull: boolean;
}): EventStateTagName {
  if (event.cancelled) {
    return 'Cancelled';
  }
  return event.isFull ? 'Full' : 'Open';
}

export function resolveStateTagId(forum: ForumChannel, name: EventStateTagName): string | null {
  return findTagIdByName(forum, name);
}

/**
 * Swaps whichever state tag is applied for the current one, leaving any other
 * tags the host added (a category, say) untouched.
 */
export async function applyStateTag(
  thread: ThreadChannel,
  forum: ForumChannel,
  stateTagName: EventStateTagName,
): Promise<void> {
  const stateTagIds = new Set(
    EVENT_STATE_TAG_NAMES.map((name) => findTagIdByName(forum, name)).filter(
      (id): id is string => id !== null,
    ),
  );

  const nextTagId = findTagIdByName(forum, stateTagName);
  if (nextTagId === null) {
    return;
  }

  const preservedTagIds = thread.appliedTags.filter((id) => !stateTagIds.has(id));
  const desiredTagIds = [...preservedTagIds, nextTagId];

  const isAlreadyCorrect =
    desiredTagIds.length === thread.appliedTags.length &&
    desiredTagIds.every((id) => thread.appliedTags.includes(id));

  if (isAlreadyCorrect) {
    return;
  }

  // Forums allow at most 5 applied tags; the state tag is the one that matters.
  await thread.setAppliedTags(desiredTagIds.slice(0, 5));
}
