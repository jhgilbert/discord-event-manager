import { randomUUID } from 'node:crypto';
import type { EventModalTarget } from '../discord/custom-ids.js';
import type { RawEventForm } from '../domain/event-form.js';

/**
 * Holds what a host typed when their submission failed validation, so the
 * "Fix it" button can reopen the modal prefilled.
 *
 * Deliberately in memory rather than SQLite: it is worth seconds, and a
 * restart losing a half-finished form costs one retype. Persisting it would
 * mean a table that needs its own cleanup.
 */
interface EventDraft {
  userId: string;
  target: EventModalTarget;
  values: RawEventForm;
  expiresAt: number;
}

const DRAFT_LIFETIME_MS = 15 * 60 * 1000;
const draftsByToken = new Map<string, EventDraft>();

function discardExpiredDrafts(): void {
  const now = Date.now();
  for (const [token, draft] of draftsByToken) {
    if (draft.expiresAt <= now) {
      draftsByToken.delete(token);
    }
  }
}

export function saveDraft(
  userId: string,
  target: EventModalTarget,
  values: RawEventForm,
): string {
  discardExpiredDrafts();

  const token = randomUUID();
  draftsByToken.set(token, { userId, target, values, expiresAt: Date.now() + DRAFT_LIFETIME_MS });
  return token;
}

/**
 * Single use, and checked against the clicking user: the retry button lives in
 * an ephemeral reply, but the token should not be replayable by anyone else who
 * somehow gets hold of it.
 */
export function takeDraft(token: string, userId: string): EventDraft | null {
  discardExpiredDrafts();

  const draft = draftsByToken.get(token);
  if (draft === undefined || draft.userId !== userId) {
    return null;
  }

  draftsByToken.delete(token);
  return draft;
}
