import type { EventDetails, EventRow } from './types.js';

export type EventFieldName = 'title' | 'when' | 'where' | 'capacity' | 'description';

/**
 * What an edit actually changed, compared before the update is written — once
 * the row is overwritten the previous values are gone, so there is nothing left
 * to diff against.
 *
 * The modal hands back all five fields on every submit, so without this a host
 * fixing one typo would announce five changes.
 */
export function listEventChanges(previous: EventRow, next: EventDetails): EventFieldName[] {
  const changed: EventFieldName[] = [];

  if (previous.title !== next.title) {
    changed.push('title');
  }
  if (previous.starts_at !== next.startsAt) {
    changed.push('when');
  }
  if (previous.location !== next.location) {
    changed.push('where');
  }
  if (previous.capacity !== next.capacity) {
    changed.push('capacity');
  }
  if (previous.description !== next.description) {
    changed.push('description');
  }

  return changed;
}

/**
 * Whether the change is one that could stop somebody attending — a new time or
 * a new place — as opposed to a typo in the title or a line added to the
 * description.
 *
 * This is what decides whether the notice mentions people or simply sits in the
 * thread as a record. Pinging a dozen members because a host fixed their own
 * spelling is how notifications get muted.
 */
export function changesAffectAttendeePlans(changes: EventFieldName[]): boolean {
  return changes.includes('when') || changes.includes('where');
}
