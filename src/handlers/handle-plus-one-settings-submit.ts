import { MessageFlags, type ModalSubmitInteraction } from 'discord.js';
import type { AppContext } from '../context.js';
import { findEventByMessageId, updatePlusOnePolicy } from '../db/event-queries.js';
import { listConfirmedInJoinOrder, listWaitlistInJoinOrder } from '../db/rsvp-queries.js';
import {
  arePlusOnesOpen,
  isSamePlusOnePolicy,
  parsePlusOneForm,
  readPlusOnePolicy,
  storePlusOnePolicy,
  type PlusOnePolicy,
} from '../domain/plus-one-policy.js';
import { readMessageIdFromPlusOneSettingsModalId } from '../discord/custom-ids.js';
import { isHostOrServerManager } from '../discord/event-permissions.js';
import {
  describePlusOnePolicyLine,
  describePlusOnePolicyShort,
  formatPlusOneDate,
} from '../discord/plus-one-copy.js';
import {
  buildPlusOneSettingsButton,
  readPlusOneFormFromModal,
} from '../discord/plus-one-settings-modal.js';
import { postNoticeInEventThread } from '../discord/announcements.js';
import { refreshEventPanel } from '../discord/refresh-event-panel.js';
import { withMessageLock } from '../lib/message-lock.js';
import { describeError, logger } from '../lib/logger.js';

interface PlusOneNotice {
  threadId: string;
  content: string;
}

interface SettingsOutcome {
  message: string;
  /** Offered again after a rejected form, so fixing a typo is one click. */
  offerRetry: boolean;
  notice: PlusOneNotice | null;
}

/**
 * Closing +1s keeps every guest already on the list (see plus-one-policy.ts).
 * That is easy to miss from the host's side — they might expect it to free
 * seats — so the confirmation says how many guests are staying.
 */
function describeKeptGuests(context: AppContext, messageId: string): string | null {
  const withGuests = [
    ...listConfirmedInJoinOrder(context.database, messageId),
    ...listWaitlistInJoinOrder(context.database, messageId),
  ].filter((rsvp) => rsvp.plus_one).length;

  if (withGuests === 0) {
    return null;
  }

  const people = withGuests === 1 ? '1 person already has' : `${withGuests} people already have`;
  return `${people} a guest and will keep them — this only stops new +1s.`;
}

/**
 * A plain change line in the thread, with no pings. Unlike a moved time or
 * place, this changes nobody's plans: no guest is removed by it.
 */
function buildPlusOneNotice(
  editorId: string,
  previous: PlusOnePolicy,
  next: PlusOnePolicy,
  now: number,
  timeZone: string,
): string {
  const before = describePlusOnePolicyShort(previous, now, timeZone);
  const after = describePlusOnePolicyShort(next, now, timeZone);
  return `<@${editorId}> updated this event:\n· **+1s** — ${before} → **${after}**`;
}

async function applyPlusOneSettings(
  context: AppContext,
  interaction: ModalSubmitInteraction,
  messageId: string,
): Promise<SettingsOutcome> {
  const { TZ } = context.environment;

  return withMessageLock(messageId, async (): Promise<SettingsOutcome> => {
    const event = findEventByMessageId(context.database, messageId);

    if (event === null) {
      return { message: 'That event no longer exists.', offerRetry: false, notice: null };
    }

    // Re-checked at submit: a form can sit open for a long while.
    if (!isHostOrServerManager(interaction, event)) {
      return {
        message: 'Only the host or a server manager can change the +1 settings.',
        offerRetry: false,
        notice: null,
      };
    }

    if (event.cancelled) {
      return {
        message: 'This event was canceled and can no longer be edited.',
        offerRetry: false,
        notice: null,
      };
    }

    // Parsed inside the lock because it validates against the start time,
    // which a concurrent edit could be changing.
    const parsed = parsePlusOneForm(readPlusOneFormFromModal(interaction), event.starts_at, (unix) =>
      formatPlusOneDate(unix, TZ),
    );

    if (!parsed.ok) {
      return {
        message: ["That didn't quite work:", ...parsed.problems.map((problem) => `· ${problem}`)].join('\n'),
        offerRetry: true,
        notice: null,
      };
    }

    const now = Math.floor(Date.now() / 1000);
    const previous = readPlusOnePolicy(event);
    const next = parsed.policy;

    if (isSamePlusOnePolicy(previous, next)) {
      return { message: 'Nothing changed.', offerRetry: false, notice: null };
    }

    const unlocksLater = next.kind === 'allowed-from' && !arePlusOnesOpen(next, now);
    updatePlusOnePolicy(context.database, messageId, storePlusOnePolicy(next), unlocksLater);
    await refreshEventPanel(context, messageId);

    logger.info('plus-one policy updated', {
      messageId,
      editedBy: interaction.user.id,
      allowedFrom: storePlusOnePolicy(next),
    });

    const keptGuests = arePlusOnesOpen(next, now) ? null : describeKeptGuests(context, messageId);

    return {
      message: [`Saved. ${describePlusOnePolicyLine(next, now, TZ)}`, ...(keptGuests ? [keptGuests] : [])].join(
        '\n',
      ),
      offerRetry: false,
      notice: {
        threadId: event.thread_id,
        content: buildPlusOneNotice(interaction.user.id, previous, next, now, TZ),
      },
    };
  });
}

export async function handlePlusOneSettingsSubmit(
  context: AppContext,
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const messageId = readMessageIdFromPlusOneSettingsModalId(interaction.customId);
  if (messageId === null) {
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const outcome = await applyPlusOneSettings(context, interaction, messageId);

    await interaction.editReply({
      content: outcome.message,
      components: outcome.offerRetry ? [buildPlusOneSettingsButton(messageId)] : [],
    });

    if (outcome.notice !== null) {
      const { content } = outcome.notice;
      await postNoticeInEventThread(context, outcome.notice.threadId, () => content, []);
    }
  } catch (error: unknown) {
    logger.error('plus-one settings submission failed', {
      messageId,
      userId: interaction.user.id,
      ...describeError(error),
    });

    await interaction
      .editReply({ content: 'Something went wrong saving those settings. Please try again.', components: [] })
      .catch(() => undefined);
  }
}
