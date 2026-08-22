import type { Client, ForumChannel, TextChannel } from 'discord.js';
import type { EventDatabase } from './db/database.js';
import type { Environment } from './config/environment.js';

/**
 * Everything a handler needs, passed as one argument. Plain data rather than a
 * service class — nothing here has behaviour of its own, and passing it
 * explicitly keeps handlers callable in isolation.
 */
export interface AppContext {
  client: Client;
  database: EventDatabase;
  environment: Environment;
  forum: ForumChannel;
  launcherChannel: TextChannel;
}
