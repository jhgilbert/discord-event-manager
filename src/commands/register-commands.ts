import type { Client } from 'discord.js';
import { buildEventCommandDefinition } from './event-command.js';
import { logger } from '../lib/logger.js';

/**
 * Registered to the one guild rather than globally: guild commands appear
 * immediately, while global ones can take up to an hour to propagate. This bot
 * serves a single server, so there is no reason to wait.
 *
 * `set` replaces the guild's command list wholesale, which makes this safe to
 * run on every boot — no accumulation of renamed or removed commands.
 */
export async function registerGuildCommands(client: Client, guildId: string): Promise<void> {
  if (client.application === null) {
    throw new Error('Cannot register commands before the client is ready.');
  }

  await client.application.commands.set([buildEventCommandDefinition()], guildId);
  logger.info('registered guild commands', { guildId });
}
