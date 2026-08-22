import { Client, Events, GatewayIntentBits, type Client as DiscordClient } from 'discord.js';
import { loadEnvironment, type Environment } from './config/environment.js';
import { openDatabase, type EventDatabase } from './db/database.js';
import { registerGuildCommands } from './commands/register-commands.js';
import { fetchForumChannel, fetchTextChannel } from './discord/channels.js';
import { warnAboutMissingStateTags } from './discord/forum-tags.js';
import { ensureLauncherPanelExists } from './discord/launcher-panel.js';
import { handleInteraction } from './handlers/handle-interaction.js';
import { startReminderJob } from './jobs/reminder-job.js';
import type { AppContext } from './context.js';
import { describeError, logger } from './lib/logger.js';

async function buildAppContext(
  client: DiscordClient,
  database: EventDatabase,
  environment: Environment,
): Promise<AppContext> {
  const [forum, launcherChannel] = await Promise.all([
    fetchForumChannel(client, environment.EVENTS_FORUM_CHANNEL_ID),
    fetchTextChannel(client, environment.LAUNCHER_CHANNEL_ID),
  ]);

  return { client, database, environment, forum, launcherChannel };
}

/**
 * `Guilds` only. Reading message content or member lists would need privileged
 * intents and verification; buttons, modals and slash commands all arrive as
 * interactions, which need neither.
 */
function createDiscordClient(): DiscordClient {
  return new Client({ intents: [GatewayIntentBits.Guilds] });
}

async function startBot(): Promise<void> {
  const environment = loadEnvironment();
  const database = openDatabase(environment.DATABASE_PATH);
  const client = createDiscordClient();

  let stopReminderJob: (() => void) | null = null;

  client.once(Events.ClientReady, (readyClient) => {
    void (async () => {
      try {
        const context = await buildAppContext(readyClient, database, environment);

        warnAboutMissingStateTags(context.forum);
        await registerGuildCommands(readyClient, environment.DISCORD_GUILD_ID);
        await ensureLauncherPanelExists(context.launcherChannel, readyClient.user.id);

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
        logger.error('startup failed', describeError(error));
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

  await client.login(environment.DISCORD_TOKEN);
}

startBot().catch((error: unknown) => {
  logger.error('failed to start', describeError(error));
  process.exit(1);
});
