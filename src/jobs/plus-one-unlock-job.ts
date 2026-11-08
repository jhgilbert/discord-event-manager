import type { AppContext } from '../context.js';
import {
  clearPlusOneUnlockPending,
  findEventsDueForPlusOneUnlock,
} from '../db/event-queries.js';
import { announcePlusOnesOpen } from '../discord/announcements.js';
import { refreshEventPanel } from '../discord/refresh-event-panel.js';
import { describeError, logger } from '../lib/logger.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * A few seconds past the hour, so a clock running slightly fast cannot sweep
 * just before midnight and leave the event waiting a whole extra hour.
 */
const PAST_THE_HOUR_MS = 5 * 1000;

/**
 * On the hour rather than an hour after boot, because the dates open at
 * midnight and the post counts down to it ("in 2 hours"). Swept an hour after
 * boot, the post could read "12 minutes ago" while the button was still
 * greyed out. (In a timezone whose offset is not whole hours, midnight falls on
 * the half hour and this lags by thirty minutes.)
 */
function msUntilNextSweep(nowMs: number): number {
  return HOUR_MS - (nowMs % HOUR_MS) + PAST_THE_HOUR_MS;
}

/**
 * The panel is only re-rendered when something happens to the event, and the
 * arrival of a date is not something happening — so on a quiet event the +1
 * button would stay greyed out long after it should have opened. This is the
 * render nothing else would trigger.
 *
 * Cleared *after* the render, so a crash in between costs one redundant edit
 * rather than a button locked for good — but *before* the thread message, so
 * a crash there costs a missed message rather than a duplicate one. The same
 * at-most-once trade the reminder sweep makes.
 *
 * The message pings nobody: everyone who RSVPed is a member of the thread
 * (see thread-membership.ts), so it reaches them according to their own
 * settings for it.
 */
export async function runPlusOneUnlockSweep(context: AppContext): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  for (const event of findEventsDueForPlusOneUnlock(context.database, now)) {
    await refreshEventPanel(context, event.message_id);
    clearPlusOneUnlockPending(context.database, event.message_id);
    await announcePlusOnesOpen(context, event.thread_id);
    logger.info('unlocked plus-ones on event panel', { messageId: event.message_id });
  }
}

export function startPlusOneUnlockJob(context: AppContext): () => void {
  const sweep = () => {
    void runPlusOneUnlockSweep(context).catch((error: unknown) => {
      logger.error('plus-one unlock sweep failed', describeError(error));
    });
  };

  // Rescheduled after each sweep rather than with setInterval, which drifts
  // off the hour over weeks of uptime.
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
