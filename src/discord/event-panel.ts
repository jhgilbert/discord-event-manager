import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type APIEmbedField,
} from 'discord.js';
import { RSVP_BUTTON_IDS } from './custom-ids.js';
import { summarizeCapacity } from '../domain/capacity.js';
import { arePlusOnesOpen, readPlusOnePolicy } from '../domain/plus-one-policy.js';
import { formatPersonForPanel } from './display-names.js';
import { describePlusOnePolicyLine } from './plus-one-copy.js';
import type { EventRow, RsvpRow } from '../domain/types.js';

/** Discord's hard caps. Exceeding either is a 400, not a truncation. */
const FIELD_VALUE_MAX = 1024;
const EMBED_TOTAL_MAX = 6000;
/** Slack for field names and multi-byte characters in names. */
const EMBED_BUDGET_SAFETY_MARGIN = 400;

const COLOUR_OPEN = 0x57f287;
const COLOUR_FULL = 0xe67e22;
const COLOUR_CANCELLED = 0x99aab5;

function formatAttendeeLine(rsvp: RsvpRow): string {
  return `${formatPersonForPanel(rsvp.user_id, rsvp.display_name)}${rsvp.plus_one ? ' **+1**' : ''}`;
}

function formatWaitlistLine(rsvp: RsvpRow, index: number): string {
  return `${index + 1}. ${formatAttendeeLine(rsvp)}`;
}

/**
 * Fills the budget line by line and says how many were dropped, rather than
 * cutting mid-mention and leaving a broken `<@1234` on screen.
 */
function joinLinesWithinBudget(lines: string[], budget: number): string {
  const kept: string[] = [];
  let used = 0;

  for (const line of lines) {
    const cost = line.length + 1;
    // Reserve room for the "…and N more" note we may still need to append.
    if (used + cost > budget - 24) {
      break;
    }
    kept.push(line);
    used += cost;
  }

  const dropped = lines.length - kept.length;
  if (dropped > 0) {
    kept.push(`…and ${dropped} more`);
  }

  return kept.join('\n');
}

function describeSpots(event: EventRow, confirmed: RsvpRow[]): string {
  const { taken, capacity, isOverSubscribed } = summarizeCapacity(event, confirmed);
  const line = `**${taken}** of **${capacity}** spots taken`;

  // Rendered plainly rather than clamped, so a host who lowered capacity below
  // the confirmed headcount can see that they did.
  return isOverSubscribed ? `${line} — over capacity` : line;
}

/** A name rather than a mention, for the reason in display-names.ts. */
function buildHostField(event: EventRow): APIEmbedField {
  return { name: 'Host', value: formatPersonForPanel(event.host_id, event.host_display_name) };
}

function buildWhenField(event: EventRow): APIEmbedField {
  // `<t:…>` renders in each viewer's own timezone, so the bot never has to
  // guess where anyone is.
  return {
    name: 'When',
    value: `<t:${event.starts_at}:F> (<t:${event.starts_at}:R>)`,
  };
}

/**
 * The waitlist is kept whole and the going list is truncated first. A cut going
 * list is cosmetic; a cut waitlist means someone cannot see their own position,
 * which is the only reason it is numbered.
 */
function computeGoingFieldBudget(spentOnEverythingElse: number): number {
  const remainingTotalBudget = EMBED_TOTAL_MAX - EMBED_BUDGET_SAFETY_MARGIN - spentOnEverythingElse;
  return Math.max(0, Math.min(FIELD_VALUE_MAX, remainingTotalBudget));
}

/**
 * The last line of the post, directly above the buttons — the place to say why
 * the +1 button is greyed out, next to the thing it explains.
 *
 * A field rather than the embed footer, because Discord renders footers in
 * small grey text and this line is one people need to read. Fields must have
 * a name, so a zero-width space stands in for one: a heading saying "+1s"
 * above a sentence starting "+1s" would only repeat it.
 */
const UNNAMED_FIELD = '\u200b';

function buildClosingLine(event: EventRow, now: number, timeZone: string): string {
  if (event.cancelled) {
    return 'This event was canceled.';
  }
  if (event.ended) {
    return 'This event has ended.';
  }
  return describePlusOnePolicyLine(readPlusOnePolicy(event), now, timeZone);
}

function buildPanelEmbed(
  event: EventRow,
  confirmed: RsvpRow[],
  waiting: RsvpRow[],
  now: number,
  timeZone: string,
): EmbedBuilder {
  const { isFull } = summarizeCapacity(event, confirmed);
  const description = event.description ?? '';
  const spotsValue = describeSpots(event, confirmed);

  const waitlistValue =
    waiting.length > 0
      ? joinLinesWithinBudget(waiting.map(formatWaitlistLine), FIELD_VALUE_MAX)
      : '';

  const closingLine = buildClosingLine(event, now, timeZone);
  const hostField = buildHostField(event);
  const whenField = buildWhenField(event);
  const locationValue = event.location ?? '';

  const goingValue =
    confirmed.length > 0
      ? joinLinesWithinBudget(
          confirmed.map(formatAttendeeLine),
          computeGoingFieldBudget(
            event.title.length +
              description.length +
              hostField.value.length +
              whenField.value.length +
              locationValue.length +
              spotsValue.length +
              waitlistValue.length +
              closingLine.length,
          ),
        )
      : '_Nobody yet — be the first._';

  const fields: APIEmbedField[] = [hostField, whenField];

  // Omitted entirely when the host left it blank; an empty "Where" field reads
  // like missing information rather than a deliberate choice.
  if (locationValue !== '') {
    fields.push({ name: 'Where', value: locationValue });
  }

  fields.push({ name: 'Going', value: goingValue });
  fields.push({ name: 'Spots', value: spotsValue });

  // Hidden when empty: a visible empty waitlist on a half-full event reads like
  // the event is already full.
  if (waitlistValue !== '') {
    fields.push({ name: 'Waitlist', value: waitlistValue });
  }

  fields.push({ name: UNNAMED_FIELD, value: closingLine });

  const embed = new EmbedBuilder()
    .setTitle(event.cancelled ? `❌ ${event.title} (canceled)` : event.title)
    .setColor(event.cancelled ? COLOUR_CANCELLED : isFull ? COLOUR_FULL : COLOUR_OPEN)
    .addFields(fields);

  return description === '' ? embed : embed.setDescription(description);
}

/**
 * Buttons stay enabled at capacity — a click then returns an ephemeral
 * "you're on the waitlist at #4". Disabling them would be cosmetic anyway: a
 * stale client still shows them enabled, so the server-side check is required
 * either way. Cancellation and the event ending are different, and really do
 * disable them.
 *
 * Closed +1s disable the +1 button for the same reason: they are a rule, not a
 * state that changes with every click. The click handler enforces the rule
 * regardless, since a stale client can still send the click.
 */
function buildRsvpButtons(event: EventRow, now: number): ActionRowBuilder<ButtonBuilder> {
  const disabled = Boolean(event.cancelled || event.ended);
  const plusOneDisabled = disabled || !arePlusOnesOpen(readPlusOnePolicy(event), now);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(RSVP_BUTTON_IDS.goingSolo)
      .setLabel('RSVP')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(RSVP_BUTTON_IDS.goingPlusOne)
      .setLabel('RSVP +1')
      .setStyle(ButtonStyle.Success)
      .setDisabled(plusOneDisabled),
    new ButtonBuilder()
      .setCustomId(RSVP_BUTTON_IDS.withdraw)
      .setLabel('Cancel RSVP')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

/**
 * `timeZone` is for the +1 date on the last line, which is plain text and so
 * has to be written in one fixed zone — the same trade the thread name makes.
 */
export function renderEventPanel(
  event: EventRow,
  confirmed: RsvpRow[],
  waiting: RsvpRow[],
  timeZone: string,
) {
  const now = Math.floor(Date.now() / 1000);

  return {
    embeds: [buildPanelEmbed(event, confirmed, waiting, now, timeZone)],
    components: [buildRsvpButtons(event, now)],
  };
}
