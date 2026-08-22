import * as chrono from 'chrono-node';
import { z } from 'zod';
import type { EventDetails } from './types.js';

/** Discord's own limits, mirrored here so validation matches the modal. */
export const TITLE_MAX_LENGTH = 90;
export const DESCRIPTION_MAX_LENGTH = 4000;
export const LOCATION_MAX_LENGTH = 200;
export const CAPACITY_MAX = 10_000;

/** The five modal fields, exactly as Discord hands them back: all strings. */
export interface RawEventForm {
  title: string;
  when: string;
  description: string;
  location: string;
  capacity: string;
}

function optionalTextField(label: string, maxLength: number) {
  return z
    .string()
    .trim()
    .max(maxLength, `${label} must be ${maxLength} characters or fewer.`)
    .transform((value) => (value === '' ? null : value));
}

/**
 * chrono resolves relative phrases against the process clock, so `TZ` decides
 * what "Friday 7pm" means. `forwardDate` makes bare weekdays and times point at
 * the next occurrence rather than the most recent one.
 */
const startsAtField = z
  .string()
  .trim()
  .min(1, 'Date/time is required.')
  .transform((raw, ctx) => {
    const parsed = chrono.parseDate(raw, new Date(), { forwardDate: true });

    if (parsed === null) {
      ctx.addIssue({
        code: 'custom',
        message: `Could not read "${raw}" as a date. Try something like "Friday 7pm" or "March 3 18:30".`,
      });
      return z.NEVER;
    }

    // A minute of slack so "in 1 minute" does not race the round-trip.
    if (parsed.getTime() < Date.now() - 60_000) {
      ctx.addIssue({ code: 'custom', message: 'That date and time is in the past.' });
      return z.NEVER;
    }

    return Math.floor(parsed.getTime() / 1000);
  });

/**
 * Text input rather than a select: a select would make the value structurally
 * valid but force preset capacities. Arbitrary numbers are worth the parsing.
 */
const capacityField = z
  .string()
  .trim()
  .min(1, 'Capacity is required.')
  .transform((raw, ctx) => {
    const parsed = Number(raw);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > CAPACITY_MAX) {
      ctx.addIssue({
        code: 'custom',
        message: `Capacity must be a whole number between 1 and ${CAPACITY_MAX.toLocaleString()}.`,
      });
      return z.NEVER;
    }

    return parsed;
  });

const EventFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required.')
    .max(TITLE_MAX_LENGTH, `Title must be ${TITLE_MAX_LENGTH} characters or fewer.`),
  when: startsAtField,
  description: optionalTextField('Description', DESCRIPTION_MAX_LENGTH),
  location: optionalTextField('Location', LOCATION_MAX_LENGTH),
  capacity: capacityField,
});

export type ParsedEventForm = z.infer<typeof EventFormSchema>;

export type EventFormResult =
  | { ok: true; details: EventDetails }
  | { ok: false; problems: string[] };

export function parseEventForm(raw: RawEventForm): EventFormResult {
  const result = EventFormSchema.safeParse(raw);

  if (!result.success) {
    return { ok: false, problems: result.error.issues.map((issue) => issue.message) };
  }

  const { title, when, description, location, capacity } = result.data;
  return { ok: true, details: { title, description, location, startsAt: when, capacity } };
}
