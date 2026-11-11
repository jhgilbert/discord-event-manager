import type { AppContext } from '../context.js';
import { findEventsDueForReminder, markReminderSent } from '../db/event-queries.js';
import { listConfirmedInJoinOrder } from '../db/rsvp-queries.js';
import { announceEventReminder } from '../discord/announcements.js';
import { isReservedSeat } from '../domain/reserved-seats.js';
import { describeError, logger } from '../lib/logger.js';

const QUARTER_HOUR_MS = 15 * 60 * 1000;

/**
 * A few seconds past the quarter hour, so a clock running slightly fast cannot
 * sweep just before an event's reminder point and post it 15 minutes late.
 */
const PAST_THE_QUARTER_MS = 5 * 1000;

/**
 * On the quarter hour rather than every 15 minutes from boot, because events
 * start on the hour or half hour, and so do their reminder points. Counted from
 * boot, a 6 pm reminder could go out at 6:14. (Every timezone offset in use is
 * a whole number of quarter hours, so this lines up with local time too.)
 */
function msUntilNextSweep(nowMs: number): number {
  return QUARTER_HOUR_MS - (nowMs % QUARTER_HOUR_MS) + PAST_THE_QUARTER_MS;
}

/**
 * An event posted for tonight, with the reminder set to the day before, was
 * already past its reminder point when it was created. Firing anyway would ping
 * whoever happened to have RSVPed in the first sixty seconds and nobody else —
 * so treat short notice as its own notice, the way a calendar does.
 *
 * Rows written before `created_at` existed hold 0 and are never short notice.
 */
function wasCreatedInsideReminderWindow(
  event: { starts_at: number; created_at: number },
  leadMinutes: number,
): boolean {
  return event.created_at > 0 && event.created_at >= event.starts_at - leadMinutes * 60;
}

async function sendReminderFor(
  context: AppContext,
  event: { message_id: string; thread_id: string; title: string; starts_at: number },
): Promise<void> {
  const confirmed = listConfirmedInJoinOrder(context.database, event.message_id);

  // The waitlist is deliberately not pinged: they do not have a seat, and
  // "your event starts soon" to someone who is not going is just noise.
  // Reserved seats are skipped too: whoever reserved one is the host or a
  // server manager, who knows when their own event starts.
  await announceEventReminder(
    context,
    event.thread_id,
    confirmed.filter((rsvp) => !isReservedSeat(rsvp)).map((rsvp) => rsvp.user_id),
    event.title,
    event.starts_at,
  );
}

export async function runReminderSweep(context: AppContext): Promise<void> {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const windowEndsAt = nowInSeconds + context.environment.REMINDER_LEAD_MINUTES * 60;

  for (const event of findEventsDueForReminder(context.database, windowEndsAt)) {
    // Marked before sending, making this at-most-once: a crash mid-send costs
    // one missed reminder, where at-least-once would cost a duplicate ping to
    // everyone attending. For a notification, the silent failure is the kinder
    // one.
    markReminderSent(context.database, event.message_id);

    // An event that already started is swept up and marked without posting, so
    // a bot that was down over a weekend does not wake up and announce a batch
    // of events that are already over.
    if (event.starts_at < nowInSeconds) {
      logger.info('skipping stale reminder', { messageId: event.message_id });
      continue;
    }

    if (wasCreatedInsideReminderWindow(event, context.environment.REMINDER_LEAD_MINUTES)) {
      logger.info('skipping reminder for short-notice event', { messageId: event.message_id });
      continue;
    }

    await sendReminderFor(context, event);
    logger.info('sent event reminder', { messageId: event.message_id });
  }
}

export function startReminderJob(context: AppContext): () => void {
  const sweep = () => {
    void runReminderSweep(context).catch((error: unknown) => {
      logger.error('reminder sweep failed', describeError(error));
    });
  };

  // Rescheduled after each sweep rather than with setInterval, which drifts
  // off the quarter hour over weeks of uptime.
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
