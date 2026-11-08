import type { AppContext } from '../context.js';
import { findEventByMessageId } from '../db/event-queries.js';
import type { EventRow } from '../domain/types.js';

/**
 * Commands about one event are run inside the event's own post, so the channel
 * the command came from *is* the event: for a forum post the thread ID, the
 * starter message ID and our primary key are all the same snowflake.
 */
export function findEventForChannel(context: AppContext, channelId: string): EventRow | null {
  return findEventByMessageId(context.database, channelId);
}

export const NOT_IN_AN_EVENT_POST =
  "Run this inside the event's own post in the events forum — that's how I know which event you mean.";
