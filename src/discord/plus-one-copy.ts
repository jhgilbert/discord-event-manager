import { arePlusOnesOpen, type PlusOnePolicy } from '../domain/plus-one-policy.js';

/**
 * Plain text rather than `<t:…:D>`: the date is a whole day in `TZ`, so there
 * is no per-viewer time to localise, and the same string has to work in the
 * settings form's prefill, where markup is not rendered.
 */
export function formatPlusOneDate(unix: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  }).format(new Date(unix * 1000));
}

/**
 * Once the date has passed it drops out of the line: "allowed on or after" a
 * day that is already behind us reads like a rule still waiting to apply.
 */
export function describePlusOnePolicyLine(
  policy: PlusOnePolicy,
  now: number,
  timeZone: string,
): string {
  if (policy.kind === 'not-allowed') {
    return 'The host has not configured this event to allow +1s.';
  }

  return arePlusOnesOpen(policy, now)
    ? '+1s are allowed.'
    : `+1s are allowed on or after ${formatPlusOneDate(policy.from, timeZone)}.`;
}

/** For change lists, where the line is "old → new" and the full sentence would not fit. */
export function describePlusOnePolicyShort(
  policy: PlusOnePolicy,
  now: number,
  timeZone: string,
): string {
  if (policy.kind === 'not-allowed') {
    return 'not allowed';
  }

  return arePlusOnesOpen(policy, now)
    ? 'allowed'
    : `allowed on or after ${formatPlusOneDate(policy.from, timeZone)}`;
}

/** Why a guest was refused. Only called while +1s are closed. */
export function describeWhyPlusOnesAreClosed(policy: PlusOnePolicy, timeZone: string): string {
  return policy.kind === 'not-allowed'
    ? "The host hasn't allowed +1s for this event."
    : `+1s open on ${formatPlusOneDate(policy.from, timeZone)}.`;
}
