import type { AppContext } from '../context.js';
import { findEventsThatHaveEnded, markEventEnded } from '../db/event-queries.js';
import { lockAndCloseThread, refreshEventPanelNow } from '../discord/refresh-event-panel.js';
import { withMessageLock } from '../lib/message-lock.js';
import { describeError, logger } from '../lib/logger.js';
import { startOfDay } from '../lib/start-of-day.js';

/**
 * Tidying, not timekeeping: a post that closes a few hours late costs nothing,
 * so once a day is plenty. It also runs at every boot, which on Railway means
 * every deploy.
 */
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function closePastEvent(context: AppContext, messageId: string, threadId: string): Promise<void> {
  await withMessageLock(messageId, async () => {
    markEventEnded(context.database, messageId);

    // Immediate rather than debounced: the panel has to show the ended state
    // before the thread is closed underneath it.
    await refreshEventPanelNow(context, messageId);
  });

  await lockAndCloseThread(context, threadId);
}

/**
 * Marked before the Discord calls, so a post someone already deleted by hand
 * is not retried every day. A Discord failure part-way leaves the post open,
 * which is untidy rather than wrong: the buttons and commands already refuse
 * an ended event.
 */
export async function runPastEventSweep(context: AppContext): Promise<void> {
  // Events only have a start time, so "over" means the day it started has
  // ended — midnight in `TZ`. That leaves the evening itself for "running
  // late" messages in the thread.
  const startOfToday = startOfDay(new Date());

  for (const event of findEventsThatHaveEnded(context.database, startOfToday)) {
    try {
      await closePastEvent(context, event.message_id, event.thread_id);
      logger.info('closed past event', { messageId: event.message_id });
    } catch (error: unknown) {
      // One bad post must not stop the rest of the sweep.
      logger.warn('could not close past event', { messageId: event.message_id, ...describeError(error) });
    }
  }
}

export function startPastEventJob(context: AppContext): () => void {
  const sweep = () => {
    void runPastEventSweep(context).catch((error: unknown) => {
      logger.error('past event sweep failed', describeError(error));
    });
  };

  sweep();
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);

  return () => clearInterval(timer);
}
