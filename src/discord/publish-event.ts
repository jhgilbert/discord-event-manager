import { ThreadAutoArchiveDuration, type ThreadChannel } from 'discord.js';
import type { AppContext } from '../context.js';
import { insertEventAndSeatHost } from '../db/event-queries.js';
import { summarizeCapacity } from '../domain/capacity.js';
import type { EventDetails, EventRow, RsvpRow } from '../domain/types.js';
import { renderEventPanel } from './event-panel.js';
import { buildEventThreadName } from './event-thread-name.js';
import { chooseStateTagName, resolveStateTagId } from './forum-tags.js';

/**
 * The panel has to be rendered before the post exists, because it *is* the
 * post's starter message. This builds the row the renderer expects, with the
 * ID filled in afterwards.
 */
function buildUnpublishedEventRow(
  hostId: string,
  guildId: string,
  details: EventDetails,
): EventRow {
  return {
    message_id: '',
    thread_id: '',
    guild_id: guildId,
    host_id: hostId,
    title: details.title,
    description: details.description,
    location: details.location,
    starts_at: details.startsAt,
    capacity: details.capacity,
    cancelled: 0,
    reminder_sent: 0,
    // Rendering never reads this; the row that gets stored is stamped by
    // insertEvent, so the two cannot drift.
    created_at: 0,
    // Matches what insertEvent stores: a new event starts with +1s off.
    plus_ones_allowed_from: null,
    plus_one_unlock_pending: 0,
  };
}

/**
 * The host's seat as the panel needs to see it, before the row it mirrors can
 * exist — the RSVP is keyed by the message ID, and the message is the thing
 * being created. Rendering reads neither ID nor timestamp; the stored row is
 * written by insertEventAndSeatHost, so the two cannot drift.
 */
function buildHostRsvpRow(hostId: string): RsvpRow {
  return {
    message_id: '',
    user_id: hostId,
    plus_one: 0,
    status: 'confirmed',
    created_at: 0,
  };
}

export interface PublishedEvent {
  messageId: string;
  thread: ThreadChannel;
}

/**
 * The bot authors the post so that description, counts, roster and buttons all
 * live on the starter message. A bot can only edit its own messages, so a
 * host-authored post could never carry a live panel.
 */
export async function publishNewEvent(
  context: AppContext,
  hostId: string,
  guildId: string,
  details: EventDetails,
): Promise<PublishedEvent> {
  const event = buildUnpublishedEventRow(hostId, guildId, details);
  const hostRsvp = buildHostRsvpRow(hostId);

  // A capacity of one is full the moment the host takes their seat, so the
  // opening tag is chosen rather than assumed.
  const { isFull } = summarizeCapacity(event, [hostRsvp]);
  const stateTagId = resolveStateTagId(context.forum, chooseStateTagName({ cancelled: 0, isFull }));

  const thread = await context.forum.threads.create({
    name: buildEventThreadName(details.title, details.startsAt, context.environment.TZ),
    // One week is the maximum; it keeps posts editable for the whole run-up to
    // an event without the handler having to unarchive on every click.
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    appliedTags: stateTagId === null ? [] : [stateTagId],
    message: renderEventPanel(event, [hostRsvp], [], context.environment.TZ),
  });

  // For forum posts the starter message ID equals the thread ID, which is why
  // one column can serve as the primary key for both.
  insertEventAndSeatHost(context.database, {
    messageId: thread.id,
    threadId: thread.id,
    guildId,
    hostId,
    ...details,
  });

  return { messageId: thread.id, thread };
}
