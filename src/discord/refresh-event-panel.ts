import type { Message, ThreadChannel } from 'discord.js';
import type { AppContext } from '../context.js';
import { findEventByMessageId } from '../db/event-queries.js';
import { listConfirmedInJoinOrder, listWaitlistInJoinOrder } from '../db/rsvp-queries.js';
import { summarizeCapacity } from '../domain/capacity.js';
import { fillInMissingDisplayNames } from './backfill-display-names.js';
import { applyStateTag, chooseStateTagName } from './forum-tags.js';
import { renderEventPanel } from './event-panel.js';
import { describeError, logger } from '../lib/logger.js';

/**
 * Forum posts auto-archive, and editing a message in an archived thread fails.
 * Unarchiving is cheap and idempotent, so it happens before every edit rather
 * than being inferred from an error.
 */
export async function ensureThreadIsEditable(thread: ThreadChannel): Promise<void> {
  if (thread.archived) {
    await thread.setArchived(false);
  }
}

export async function fetchEventThread(
  context: AppContext,
  threadId: string,
): Promise<ThreadChannel | null> {
  const channel = await context.client.channels.fetch(threadId).catch(() => null);
  return channel !== null && channel.isThread() ? channel : null;
}

async function fetchStarterMessage(thread: ThreadChannel): Promise<Message | null> {
  // For a forum post the starter message shares the thread's ID, so this is a
  // direct fetch rather than a search.
  return thread.messages.fetch(thread.id).catch(() => null);
}

/**
 * Bypasses the debounce below. Used where the render must land before the next
 * step — cancellation, which archives the thread immediately afterwards.
 */
export async function refreshEventPanelNow(
  context: AppContext,
  messageId: string,
): Promise<void> {
  const alreadyScheduled = scheduledRefreshes.get(messageId);
  if (alreadyScheduled !== undefined) {
    clearTimeout(alreadyScheduled);
    scheduledRefreshes.delete(messageId);
  }

  lastRefreshStartedAt.set(messageId, Date.now());
  await writeEventPanel(context, messageId);
}

async function writeEventPanel(context: AppContext, messageId: string): Promise<void> {
  const storedEvent = findEventByMessageId(context.database, messageId);
  if (storedEvent === null) {
    return;
  }

  const thread = await fetchEventThread(context, storedEvent.thread_id);
  if (thread === null) {
    logger.warn('event thread is gone; skipping panel refresh', { messageId });
    return;
  }

  await ensureThreadIsEditable(thread);
  await fillInMissingDisplayNames(context, thread.guild, storedEvent);

  // Re-read so the host name the lookups just stored makes this render.
  const event = findEventByMessageId(context.database, messageId) ?? storedEvent;

  const confirmed = listConfirmedInJoinOrder(context.database, messageId);
  const waiting = listWaitlistInJoinOrder(context.database, messageId);

  const starterMessage = await fetchStarterMessage(thread);
  if (starterMessage === null) {
    logger.warn('starter message is gone; skipping panel refresh', { messageId });
    return;
  }

  await starterMessage.edit(renderEventPanel(event, confirmed, waiting, context.environment.TZ));

  const { isFull } = summarizeCapacity(event, confirmed);
  await applyStateTag(
    thread,
    context.forum,
    chooseStateTagName({ cancelled: event.cancelled, isFull }),
  ).catch((error: unknown) => {
    // A tag failure must not lose the panel edit that already succeeded.
    logger.warn('could not apply forum state tag', { messageId, ...describeError(error) });
  });
}

/**
 * Message edits start being rate limited at roughly 5 per 5 seconds per
 * channel, which a burst of RSVPs can reach.
 *
 * Leading edge plus trailing coalesce: the first click in a quiet period
 * renders immediately, and clicks arriving inside the window collapse into one
 * follow-up render. Normal traffic feels instant; a rush costs one extra second
 * instead of a 429.
 */
const REFRESH_INTERVAL_MS = 1500;
const lastRefreshStartedAt = new Map<string, number>();
const scheduledRefreshes = new Map<string, NodeJS.Timeout>();

function scheduleTrailingRefresh(context: AppContext, messageId: string, delayMs: number): void {
  if (scheduledRefreshes.has(messageId)) {
    return;
  }

  const timer = setTimeout(() => {
    scheduledRefreshes.delete(messageId);
    lastRefreshStartedAt.set(messageId, Date.now());
    void writeEventPanel(context, messageId).catch((error: unknown) => {
      logger.error('trailing panel refresh failed', { messageId, ...describeError(error) });
    });
  }, delayMs);

  timer.unref();
  scheduledRefreshes.set(messageId, timer);
}

export async function refreshEventPanel(context: AppContext, messageId: string): Promise<void> {
  const now = Date.now();
  const elapsed = now - (lastRefreshStartedAt.get(messageId) ?? 0);

  if (elapsed >= REFRESH_INTERVAL_MS) {
    lastRefreshStartedAt.set(messageId, now);
    await writeEventPanel(context, messageId);
    return;
  }

  scheduleTrailingRefresh(context, messageId, REFRESH_INTERVAL_MS - elapsed);
}
