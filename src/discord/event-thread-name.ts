/**
 * The forum list shows thread names and tags, nothing else — so the date has to
 * be in the name for a member to scan what is coming up without opening posts.
 *
 * A channel name is plain text: Discord's `<t:unix:F>` markup renders literally
 * there, not as a localised time. The date is therefore baked into one fixed
 * zone, `TZ`, while the panel inside the post keeps showing each viewer their
 * own. Everyone reading this forum is in the same zone, which is what makes
 * that trade acceptable here.
 */

/** Discord's limit on a thread name. */
const THREAD_NAME_MAX_LENGTH = 100;

/**
 * The longest the suffix can ever be: " (Wednesday, Sep 30 at 12:30 AM)".
 * `TITLE_MAX_LENGTH` in domain/event-form.ts is set to what this leaves over,
 * so a title that passes validation always fits without truncation.
 */
export const DATE_SUFFIX_MAX_LENGTH = 32;

function formatEventDate(startsAt: number, timeZone: string): string {
  const at = new Date(startsAt * 1000);

  const day = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone,
  }).format(at);

  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(at);

  return `${day} at ${time}`;
}

/**
 * Truncation protects the date rather than the title: a shortened title is
 * still recognisable, a shortened date is useless.
 */
function truncateToFit(title: string, maxLength: number): string {
  if (title.length <= maxLength) {
    return title;
  }

  return `${title.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * Only ever called on create and on edit, so the 2-per-10-minutes rename limit
 * is not a concern — that limit is what rules out live counts in the name, not
 * a date that changes when a host reschedules.
 */
export function buildEventThreadName(
  title: string,
  startsAt: number,
  timeZone: string,
): string {
  const suffix = ` (${formatEventDate(startsAt, timeZone)})`;
  return truncateToFit(title, THREAD_NAME_MAX_LENGTH - suffix.length) + suffix;
}
