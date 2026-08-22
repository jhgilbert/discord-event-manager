import { ThreadAutoArchiveDuration, type ThreadChannel } from 'discord.js';
import type { AppContext } from '../context.js';
import { insertEvent } from '../db/event-queries.js';
import type { EventDetails, EventRow } from '../domain/types.js';
import { renderEventPanel } from './event-panel.js';
import { buildEventThreadName } from './event-thread-name.js';
import { resolveStateTagId } from './forum-tags.js';

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
  const openTagId = resolveStateTagId(context.forum, 'Open');

  const thread = await context.forum.threads.create({
    name: buildEventThreadName(details.title, details.startsAt, context.environment.TZ),
    // One week is the maximum; it keeps posts editable for the whole run-up to
    // an event without the handler having to unarchive on every click.
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    appliedTags: openTagId === null ? [] : [openTagId],
    message: renderEventPanel(buildUnpublishedEventRow(hostId, guildId, details), [], []),
  });

  // For forum posts the starter message ID equals the thread ID, which is why
  // one column can serve as the primary key for both.
  insertEvent(context.database, {
    messageId: thread.id,
    threadId: thread.id,
    guildId,
    hostId,
    ...details,
  });

  return { messageId: thread.id, thread };
}
