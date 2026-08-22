import {
  Client,
  Events,
  GatewayIntentBits,
  RESTEvents,
  type Client as DiscordClient,
  type RateLimitData,
} from 'discord.js';
import { loadEnvironment, type Environment } from './config/environment.js';
import { openDatabase, type EventDatabase } from './db/database.js';
import { registerGuildCommands } from './commands/register-commands.js';
import { fetchForumChannel, fetchTextChannel } from './discord/channels.js';
import { warnAboutMissingStateTags } from './discord/forum-tags.js';
import { ensureNewEventPanelExists } from './discord/event-builder-panel.js';
import { handleInteraction } from './handlers/handle-interaction.js';
import { startReminderJob } from './jobs/reminder-job.js';
import type { AppContext } from './context.js';
import { describeError, logFatal, logger } from './lib/logger.js';

async function buildAppContext(
  client: DiscordClient,
  database: EventDatabase,
  environment: Environment,
): Promise<AppContext> {
  const [forum, eventBuilderChannel] = await Promise.all([
    fetchForumChannel(client, environment.EVENTS_FORUM_CHANNEL_ID),
    fetchTextChannel(client, environment.EVENT_BUILDER_CHANNEL_ID),
  ]);

  return { client, database, environment, forum, eventBuilderChannel };
}

/**
 * `Guilds` only. Reading message content or member lists would need privileged
 * intents and verification; buttons, modals and slash commands all arrive as
 * interactions, which need neither.
 */
function createDiscordClient(): DiscordClient {
  return new Client({ intents: [GatewayIntentBits.Guilds] });
}

/**
 * A gateway connection that stalls produces no error and no ready event: the
 * process simply sits there, having logged nothing since the database opened,
 * looking perfectly healthy to the platform. Dying loudly gives the restart
 * policy something to act on, and gives whoever reads the logs a sentence to
 * search for.
 *
 * Generous on purpose — this is a backstop for a connection that will never
 * arrive, not a timeout on a slow one.
 */
const READY_TIMEOUT_MS = 60_000;

/**
 * discord.js says nothing on its own while a connection is failing to
 * establish — no error, no event, no timeout — so its internal diagnostics are
 * relayed until the bot is ready and then detached. A handful of lines at boot
 * is a fair price for being able to see a stalled handshake at all, and for
 * being able to tell a blocked network apart from a throttled one.
 */
function relayConnectionDiagnostics(client: DiscordClient): () => void {
  const onDebug = (detail: string) => logger.info('discord debug', { detail });
  const onRateLimited = (info: RateLimitData) =>
    logger.warn('discord rate limited', { route: info.route, timeToResetMs: info.timeToReset });

  client.on(Events.Debug, onDebug);
  client.rest.on(RESTEvents.RateLimited, onRateLimited);

  return () => {
    client.off(Events.Debug, onDebug);
    client.rest.off(RESTEvents.RateLimited, onRateLimited);
  };
}

/**
 * discord.js's response to an unreachable API is to wait — undici's default
 * header timeout is five minutes — so a network fault is indistinguishable from
 * a slow start, which is the worst possible failure mode to debug from logs.
 *
 * One unauthenticated request with a short deadline turns that into a sentence
 * naming the cause: DNS failures, refused connections and silently dropped
 * packets all arrive here as different errors.
 */
const REACHABILITY_TIMEOUT_MS = 10_000;

async function reportWhetherDiscordIsReachable(): Promise<void> {
  try {
    const response = await fetch('https://discord.com/api/v10/gateway', {
      signal: AbortSignal.timeout(REACHABILITY_TIMEOUT_MS),
    });

    logger.info('discord api reachable', { status: response.status });
  } catch (error: unknown) {
    // A warning, not a fatal: the login attempt that follows is the real test,
    // and this should never be the thing that stops a bot from starting.
    logger.warn('discord api is not reachable from this container', {
      timeoutMs: REACHABILITY_TIMEOUT_MS,
      ...describeError(error),
    });
  }
}

async function startBot(): Promise<void> {
  const environment = loadEnvironment();
  const database = openDatabase(environment.DATABASE_PATH);
  const client = createDiscordClient();

  let stopReminderJob: (() => void) | null = null;

  const readyTimeout = setTimeout(() => {
    logFatal('gave up waiting for the Discord gateway', {
      waitedMs: READY_TIMEOUT_MS,
      hint: 'Logged in but never became ready. Check the token in DISCORD_TOKEN and https://discordstatus.com.',
    });
    process.exit(1);
  }, READY_TIMEOUT_MS);

  const stopConnectionDiagnostics = relayConnectionDiagnostics(client);

  client.once(Events.ClientReady, (readyClient) => {
    stopConnectionDiagnostics();
    clearTimeout(readyTimeout);

    void (async () => {
      try {
        const context = await buildAppContext(readyClient, database, environment);

        warnAboutMissingStateTags(context.forum);
        await registerGuildCommands(readyClient, environment.DISCORD_GUILD_ID);
        await ensureNewEventPanelExists(context.eventBuilderChannel, readyClient.user.id);

        client.on(Events.InteractionCreate, (interaction) => {
          void handleInteraction(context, interaction);
        });

        stopReminderJob = startReminderJob(context);

        logger.info('bot ready', {
          user: readyClient.user.tag,
          guildId: environment.DISCORD_GUILD_ID,
          timeZone: environment.TZ,
        });
      } catch (error: unknown) {
        // A misconfigured channel or missing permission should fail the deploy
        // loudly, not leave a bot connected but unable to do anything.
        logFatal('startup failed', describeError(error));
        process.exit(1);
      }
    })();
  });

  client.on(Events.Error, (error) => {
    logger.error('discord client error', describeError(error));
  });

  const shutDown = (signal: string) => {
    logger.info('shutting down', { signal });
    stopReminderJob?.();
    void client.destroy().finally(() => {
      // Closing the handle checkpoints the WAL, so the volume holds a complete
      // database rather than a database plus a journal to replay.
      database.close();
      process.exit(0);
    });
  };

  // Railway sends SIGTERM before replacing a container.
  process.on('SIGTERM', () => shutDown('SIGTERM'));
  process.on('SIGINT', () => shutDown('SIGINT'));

  // Bracketing the login means the logs distinguish the three ways this fails:
  // a token Discord rejects outright, a handshake that never completes, and a
  // connection that succeeds but cannot see a channel afterwards.
  await reportWhetherDiscordIsReachable();

  logger.info('logging in to Discord');
  await client.login(environment.DISCORD_TOKEN);
  logger.info('logged in; waiting for the gateway to send ready');
}

startBot().catch((error: unknown) => {
  logFatal('failed to start', describeError(error));
  process.exit(1);
});
