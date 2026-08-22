import type { AppContext } from '../context.js';
import { findEventsDueForReminder, markReminderSent } from '../db/event-queries.js';
import { listConfirmedInJoinOrder } from '../db/rsvp-queries.js';
import { announceEventReminder } from '../discord/announcements.js';
import { describeError, logger } from '../lib/logger.js';

/**
 * A minute of granularity is plenty for a reminder measured in hours, and the
 * query is one index scan, so this costs nothing to run forever.
 */
const SWEEP_INTERVAL_MS = 60_000;

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
  await announceEventReminder(
    context,
    event.thread_id,
    confirmed.map((rsvp) => rsvp.user_id),
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

  sweep();
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);

  return () => clearInterval(timer);
}
