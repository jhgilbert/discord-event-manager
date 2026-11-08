import type { AppContext } from '../context.js';
import { ensureThreadIsEditable, fetchEventThread } from './refresh-event-panel.js';
import { describeError, logger } from '../lib/logger.js';

/**
 * Clicking a button does not make anyone a member of the thread, and only
 * members are notified of its messages — so without this, a plain notice in
 * the thread reaches almost nobody who RSVPed. Joining them makes the thread
 * behave like following the post: from then on it notifies them according to
 * their own settings for it.
 *
 * Nobody is removed on withdrawal. They may have joined the conversation on
 * their own, and muting or leaving the thread is one click for them.
 *
 * Best-effort: a missed join costs one person some notifications, which is no
 * reason to fail a click that has already been recorded. Returns how many were
 * added, for `/event reload` to report.
 */
export async function addMembersToEventThread(
  context: AppContext,
  threadId: string,
  userIds: string[],
): Promise<number> {
  const thread = await fetchEventThread(context, threadId);
  if (thread === null || userIds.length === 0) {
    return 0;
  }

  // Adding a member is refused while the thread is archived.
  await ensureThreadIsEditable(thread).catch(() => undefined);

  let added = 0;
  for (const userId of userIds) {
    try {
      await thread.members.add(userId);
      added += 1;
    } catch (error: unknown) {
      logger.warn('could not add member to event thread', { threadId, userId, ...describeError(error) });
    }
  }

  return added;
}

export async function addToEventThread(
  context: AppContext,
  threadId: string,
  userId: string,
): Promise<void> {
  await addMembersToEventThread(context, threadId, [userId]);
}
