import { DiscordAPIError, RESTJSONErrorCodes, type Guild } from 'discord.js';
import type { AppContext } from '../context.js';
import { updateHostDisplayName } from '../db/event-queries.js';
import {
  listConfirmedInJoinOrder,
  listWaitlistInJoinOrder,
  updateRsvpDisplayName,
} from '../db/rsvp-queries.js';
import type { EventRow } from '../domain/types.js';
import { describeError, logger } from '../lib/logger.js';

/**
 * RSVPs from before names were stored have none, and a click is the only
 * thing that records one. Rather than leave a long-running event showing raw
 * mentions until every attendee happens to click again, the render looks each
 * of them up once.
 *
 * One member fetch is a plain REST call and needs no privileged intent — only
 * listing a whole server's members does.
 */

/**
 * Bounds how long one render can be held up. A post with more missing names
 * than this finishes over the next few renders.
 */
const LOOKUPS_PER_RENDER = 25;

/**
 * People who have left the server, or deleted their account. Without this,
 * every render would ask again about the same people and get the same 404.
 * In memory on purpose: a restart retrying them once is harmless.
 */
const userIdsThatAreGone = new Set<string>();

function isGoneForGood(error: unknown): boolean {
  return (
    error instanceof DiscordAPIError &&
    (error.code === RESTJSONErrorCodes.UnknownMember || error.code === RESTJSONErrorCodes.UnknownUser)
  );
}

function listUserIdsMissingAName(context: AppContext, event: EventRow): string[] {
  const missing = new Set<string>();

  if (event.host_display_name === null) {
    missing.add(event.host_id);
  }

  for (const rsvp of [
    ...listConfirmedInJoinOrder(context.database, event.message_id),
    ...listWaitlistInJoinOrder(context.database, event.message_id),
  ]) {
    if (rsvp.display_name === null) {
      missing.add(rsvp.user_id);
    }
  }

  return [...missing].filter((userId) => !userIdsThatAreGone.has(userId));
}

/**
 * Safe outside the per-event lock, which trailing renders run without: it only
 * ever writes a name, and a name is never read by the seating rules. An RSVP
 * withdrawn mid-lookup makes the update a no-op.
 */
export async function fillInMissingDisplayNames(
  context: AppContext,
  guild: Guild,
  event: EventRow,
): Promise<void> {
  for (const userId of listUserIdsMissingAName(context, event).slice(0, LOOKUPS_PER_RENDER)) {
    try {
      const member = await guild.members.fetch(userId);

      updateRsvpDisplayName(context.database, event.message_id, userId, member.displayName);
      if (userId === event.host_id) {
        updateHostDisplayName(context.database, event.message_id, member.displayName);
      }
    } catch (error: unknown) {
      // Anything else — a timeout, a rate limit — is left to the next render.
      if (isGoneForGood(error)) {
        userIdsThatAreGone.add(userId);
        continue;
      }

      logger.warn('could not look up display name', { userId, ...describeError(error) });
    }
  }
}
