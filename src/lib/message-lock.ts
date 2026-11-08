/**
 * Serialises work per event message.
 *
 * Capacity check -> write -> reconcile -> re-render must be one critical
 * section. Without this, two people clicking "RSVP" for the last seat both
 * read `remaining = 1` before either writes, and both get seated.
 *
 * Implemented as a promise chain per message ID: each task waits for the
 * previous tail, and the map entry is dropped once the chain drains so the map
 * does not grow without bound.
 */
const tailByMessageId = new Map<string, Promise<unknown>>();

function ignoreResult(): void {
  // The tail exists only for ordering; failures are surfaced to the caller.
}

export function withMessageLock<T>(messageId: string, runTask: () => Promise<T>): Promise<T> {
  const previousTail = tailByMessageId.get(messageId) ?? Promise.resolve();
  const result = previousTail.then(runTask, runTask);
  const tail = result.then(ignoreResult, ignoreResult);

  tailByMessageId.set(messageId, tail);
  void tail.then(() => {
    if (tailByMessageId.get(messageId) === tail) {
      tailByMessageId.delete(messageId);
    }
  });

  return result;
}
