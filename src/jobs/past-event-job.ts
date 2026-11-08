import type { AppContext } from '../context.js';
import { findEventsThatHaveEnded, markEventEnded } from '../db/event-queries.js';
import { lockAndCloseThread, refreshEventPanelNow } from '../discord/refresh-event-panel.js';
import { withMessageLock } from '../lib/message-lock.js';
import { describeError, logger } from '../lib/logger.js';
import { startOfDay } from '../lib/start-of-day.js';

/**
 * A few seconds past midnight, so a clock running slightly fast cannot sweep
 * just before it and leave yesterday's events open another whole day.
 */
const PAST_MIDNIGHT_MS = 5 * 1000;

/**
 * Just after midnight in `TZ`, the moment an event's day is over, rather than
 * 24 hours after boot: that left posts open until whatever time of day the bot
 * last deployed. `setHours(24)` reads the process clock like `startOfDay`
 * does, so a daylight-saving change still lands on midnight. It also runs at
 * every boot, which on Railway means every deploy.
 */
function msUntilNextSweep(nowMs: number): number {
  const nextMidnight = new Date(nowMs);
  nextMidnight.setHours(24, 0, 0, 0);
  return nextMidnight.getTime() - nowMs + PAST_MIDNIGHT_MS;
}

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

  // Rescheduled after each sweep rather than with setInterval, which would
  // keep the time of day the bot happened to boot at.
  let timer: NodeJS.Timeout;
  const scheduleNext = () => {
    timer = setTimeout(() => {
      sweep();
      scheduleNext();
    }, msUntilNextSweep(Date.now()));
  };

  sweep();
  scheduleNext();

  return () => clearTimeout(timer);
}
