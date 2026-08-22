import type { AppContext } from '../context.js';
import { ensureThreadIsEditable, fetchEventThread } from './refresh-event-panel.js';
import { describeError, logger } from '../lib/logger.js';

/** Well inside the 2000-character message limit even with long mention lists. */
const MENTIONS_PER_MESSAGE = 50;

function chunkUserIds(userIds: string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < userIds.length; index += MENTIONS_PER_MESSAGE) {
    chunks.push(userIds.slice(index, index + MENTIONS_PER_MESSAGE));
  }
  return chunks;
}

/**
 * Announcements go in-thread, never by DM. Bot DMs fail silently for anyone who
 * has them closed, with no reliable way to detect it — and posting in-thread
 * also lets the host see that the notification happened.
 */
export async function announceInEventThread(
  context: AppContext,
  threadId: string,
  buildContent: (mentions: string) => string,
  userIdsToMention: string[],
): Promise<void> {
  if (userIdsToMention.length === 0) {
    return;
  }

  const thread = await fetchEventThread(context, threadId);
  if (thread === null) {
    logger.warn('cannot announce: thread is gone', { threadId });
    return;
  }

  try {
    await ensureThreadIsEditable(thread);

    for (const chunk of chunkUserIds(userIdsToMention)) {
      await thread.send({
        content: buildContent(chunk.map((userId) => `<@${userId}>`).join(' ')),
        // Explicit allow-list so an event title containing "@everyone" can
        // never turn an announcement into a server-wide ping.
        allowedMentions: { users: chunk, parse: [] },
      });
    }
  } catch (error: unknown) {
    logger.error('failed to post thread announcement', { threadId, ...describeError(error) });
  }
}

export async function announcePromotedFromWaitlist(
  context: AppContext,
  threadId: string,
  promotedUserIds: string[],
): Promise<void> {
  await announceInEventThread(
    context,
    threadId,
    (mentions) => `${mentions} — a spot opened up and you're off the waitlist. You're in! 🎉`,
    promotedUserIds,
  );
}

export async function announceEventCancelled(
  context: AppContext,
  threadId: string,
  attendeeUserIds: string[],
  eventTitle: string,
): Promise<void> {
  await announceInEventThread(
    context,
    threadId,
    (mentions) => `${mentions} — **${eventTitle}** has been canceled. Sorry for the short notice.`,
    attendeeUserIds,
  );
}

/**
 * The absolute time is `:F` (full date *and* time) rather than `:t`, because the
 * lead is configurable: at a day's notice "starts in 1 day (7:00 pm)" leaves the
 * reader working out which day is meant. `:F` reads correctly at any lead, and
 * still renders in each viewer's own timezone.
 */
export async function announceEventReminder(
  context: AppContext,
  threadId: string,
  attendeeUserIds: string[],
  eventTitle: string,
  startsAt: number,
): Promise<void> {
  await announceInEventThread(
    context,
    threadId,
    (mentions) => `${mentions} — **${eventTitle}** starts <t:${startsAt}:R>: <t:${startsAt}:F>.`,
    attendeeUserIds,
  );
}
