import * as chrono from 'chrono-node';
import { z } from 'zod';
import type { EventRow } from './types.js';
import { startOfDay } from '../lib/start-of-day.js';

/**
 * Whether members may bring a guest. Stored as one nullable column rather than
 * a flag plus a date, so there is no row that says "not allowed, from Oct 31":
 *
 *   NULL        not allowed
 *   0           allowed, with no date
 *   unix secs   allowed from the start of that day
 *
 * The policy only gates *adding* a guest. A guest already on the list is never
 * removed by it, so closing +1s after some were taken frees nothing — the host
 * chose that over the surprise of a confirmed guest disappearing.
 */
export type PlusOnePolicy = { kind: 'not-allowed' } | { kind: 'allowed-from'; from: number };

export function readPlusOnePolicy(event: Pick<EventRow, 'plus_ones_allowed_from'>): PlusOnePolicy {
  return event.plus_ones_allowed_from === null
    ? { kind: 'not-allowed' }
    : { kind: 'allowed-from', from: event.plus_ones_allowed_from };
}

export function storePlusOnePolicy(policy: PlusOnePolicy): number | null {
  return policy.kind === 'not-allowed' ? null : policy.from;
}

export function arePlusOnesOpen(policy: PlusOnePolicy, now: number): boolean {
  return policy.kind === 'allowed-from' && policy.from <= now;
}

export function isSamePlusOnePolicy(a: PlusOnePolicy, b: PlusOnePolicy): boolean {
  return storePlusOnePolicy(a) === storePlusOnePolicy(b);
}

export const PLUS_ONE_CHOICES = {
  notAllowed: 'not-allowed',
  allowedFrom: 'allowed-from',
} as const;

/** The two form fields, exactly as Discord hands them back. */
export interface RawPlusOneForm {
  choice: string;
  allowedFrom: string;
}

/**
 * The event's start is needed to validate against: a date after it would leave
 * the button locked for the whole life of the event, which is "not allowed"
 * with extra steps — almost certainly a typo, so it is refused.
 */
function buildPlusOneFormSchema(eventStartsAt: number, formatDate: (unix: number) => string) {
  return z
    .object({
      choice: z.enum([PLUS_ONE_CHOICES.notAllowed, PLUS_ONE_CHOICES.allowedFrom], {
        message: 'Choose whether +1s are allowed.',
      }),
      allowedFrom: z.string().trim(),
    })
    .transform((form, ctx): PlusOnePolicy => {
      if (form.choice === PLUS_ONE_CHOICES.notAllowed) {
        return { kind: 'not-allowed' };
      }

      // Blank means "from now on", which is the common case and should not
      // make the host type today's date.
      if (form.allowedFrom === '') {
        return { kind: 'allowed-from', from: 0 };
      }

      const parsed = chrono.parseDate(form.allowedFrom, new Date(), { forwardDate: true });
      if (parsed === null) {
        ctx.addIssue({
          code: 'custom',
          message: `Could not read "${form.allowedFrom}" as a date. Try something like "Oct 31" or "next Friday".`,
        });
        return z.NEVER;
      }

      // "Oct 31" means the whole of Oct 31, so the time is dropped to midnight.
      const from = startOfDay(parsed);
      if (from > eventStartsAt) {
        ctx.addIssue({
          code: 'custom',
          message: `${formatDate(from)} is after the event starts, so nobody could ever add a guest. Pick an earlier date, or choose "Not allowed".`,
        });
        return z.NEVER;
      }

      return { kind: 'allowed-from', from };
    });
}

export type PlusOneFormResult =
  | { ok: true; policy: PlusOnePolicy }
  | { ok: false; problems: string[] };

export function parsePlusOneForm(
  raw: RawPlusOneForm,
  eventStartsAt: number,
  formatDate: (unix: number) => string,
): PlusOneFormResult {
  const result = buildPlusOneFormSchema(eventStartsAt, formatDate).safeParse(raw);

  return result.success
    ? { ok: true, policy: result.data }
    : { ok: false, problems: result.error.issues.map((issue) => issue.message) };
}
