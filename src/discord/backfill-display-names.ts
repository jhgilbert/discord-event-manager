import { DiscordAPIError, RESTJSONErrorCodes, type Guild } from 'discord.js';
import type { AppContext } from '../context.js';
import { updateHostDisplayName } from '../db/event-queries.js';
import {
  listConfirmedInJoinOrder,
  listWaitlistInJoinOrder,
  updateRsvpDisplayName,
} from '../db/rsvp-queries.js';
import { isReservedSeat } from '../domain/reserved-seats.js';
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

/** So `/event reload` does not try to add someone to the thread who has left. */
export function isKnownToBeGone(userId: string): boolean {
  return userIdsThatAreGone.has(userId);
}

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
    if (rsvp.display_name === null && !isReservedSeat(rsvp)) {
      missing.add(rsvp.user_id);
    }
  }

  return [...missing].filter((userId) => !userIdsThatAreGone.has(userId));
}

type LookupResult = 'stored' | 'gone' | 'failed';

/**
 * `force` skips discord.js's member cache, which can hold a nickname from
 * before it changed — the whole point of a reload.
 */
async function lookUpAndStoreName(
  context: AppContext,
  guild: Guild,
  event: EventRow,
  userId: string,
  force: boolean,
): Promise<LookupResult> {
  try {
    const member = await guild.members.fetch({ user: userId, force });

    updateRsvpDisplayName(context.database, event.message_id, userId, member.displayName);
    if (userId === event.host_id) {
      updateHostDisplayName(context.database, event.message_id, member.displayName);
    }

    userIdsThatAreGone.delete(userId);
    return 'stored';
  } catch (error: unknown) {
    // Anything else — a timeout, a rate limit — is left to the next render.
    if (isGoneForGood(error)) {
      userIdsThatAreGone.add(userId);
      return 'gone';
    }

    logger.warn('could not look up display name', { userId, ...describeError(error) });
    return 'failed';
  }
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
    await lookUpAndStoreName(context, guild, event, userId, false);
  }
}

export interface NameRefreshSummary {
  updated: number;
  /** Left the server or deleted their account; their last known name stays. */
  gone: number;
  failed: number;
}

/**
 * The host and every Discord member with an RSVP. Reserved seats are left out:
 * the host typed that name, and it has no member to look up or add.
 */
export function listDiscordMembersOnTheEvent(context: AppContext, event: EventRow): string[] {
  const discordMembers = [
    ...listConfirmedInJoinOrder(context.database, event.message_id),
    ...listWaitlistInJoinOrder(context.database, event.message_id),
  ].filter((rsvp) => !isReservedSeat(rsvp));

  return [...new Set([event.host_id, ...discordMembers.map((rsvp) => rsvp.user_id)])];
}

/**
 * For `/event reload`: everyone, not just the missing, and no per-render cap —
 * an admin asked for it and is waiting on the answer. People once found to
 * be gone are asked again, in case they rejoined.
 */
export async function refreshAllDisplayNames(
  context: AppContext,
  guild: Guild,
  event: EventRow,
): Promise<NameRefreshSummary> {
  const summary: NameRefreshSummary = { updated: 0, gone: 0, failed: 0 };

  for (const userId of listDiscordMembersOnTheEvent(context, event)) {
    const result = await lookUpAndStoreName(context, guild, event, userId, true);
    summary[result === 'stored' ? 'updated' : result] += 1;
  }

  return summary;
}
