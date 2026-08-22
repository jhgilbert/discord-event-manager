import type { EventFieldName } from '../domain/event-changes.js';
import type { EventDetails, EventRow } from '../domain/types.js';

const NOT_SET = '_not set_';

/**
 * Old value plain, new value bold, so the line can be read at a glance without
 * working out which side is which.
 *
 * Times use `<t:…:F>` on both sides: the old time is as much a local time as the
 * new one, and a reader comparing them should see them in the same zone they
 * saw the original announcement in.
 */
function describeChange(field: EventFieldName, previous: EventRow, next: EventDetails): string {
  switch (field) {
    case 'title':
      return `**Title** — ${previous.title} → **${next.title}**`;
    case 'when':
      return `**When** — <t:${previous.starts_at}:F> → **<t:${next.startsAt}:F>**`;
    case 'where':
      return `**Where** — ${previous.location ?? NOT_SET} → **${next.location ?? NOT_SET}**`;
    case 'capacity':
      return `**Spots** — ${previous.capacity} → **${next.capacity}**`;
    case 'description':
      // Descriptions run to 4000 characters, which would bury every other line
      // in the notice. The panel directly above already shows the new text.
      return '**Details** — updated, see the post above';
  }
}

/**
 * The editor is named with a mention rather than a username: it renders as
 * whatever nickname the reader sees, and it cannot ping them, because the send
 * allows only the attendee IDs it was given.
 *
 * Returns a builder rather than a string because the mention list is chunked by
 * the sender — a long attendee list becomes several messages, each carrying the
 * same change list.
 */
export function buildEventEditNotice(
  editorId: string,
  changes: EventFieldName[],
  previous: EventRow,
  next: EventDetails,
): (mentions: string) => string {
  const lines = [
    `<@${editorId}> updated this event:`,
    ...changes.map((field) => `· ${describeChange(field, previous, next)}`),
  ];

  return (mentions) =>
    mentions === ''
      ? lines.join('\n')
      : [...lines, '', `${mentions} — check that still works for you.`].join('\n');
}
