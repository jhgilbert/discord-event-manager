import { ChannelType, type Client, type ForumChannel, type TextChannel } from 'discord.js';

/**
 * Resolved once at startup rather than fetched per interaction: a mistyped or
 * wrong-type channel ID should stop the deploy, not fail silently on the first
 * click three hours later.
 */
export async function fetchForumChannel(client: Client, channelId: string): Promise<ForumChannel> {
  const channel = await client.channels.fetch(channelId);

  if (channel === null) {
    throw new Error(
      `EVENTS_FORUM_CHANNEL_ID ${channelId} was not found. Check the ID and that the bot can see the channel.`,
    );
  }

  if (channel.type !== ChannelType.GuildForum) {
    throw new Error(
      `EVENTS_FORUM_CHANNEL_ID ${channelId} is not a forum channel. Events must be posted to a forum.`,
    );
  }

  return channel;
}

export async function fetchTextChannel(client: Client, channelId: string): Promise<TextChannel> {
  const channel = await client.channels.fetch(channelId);

  if (channel === null) {
    throw new Error(
      `LAUNCHER_CHANNEL_ID ${channelId} was not found. Check the ID and that the bot can see the channel.`,
    );
  }

  if (channel.type !== ChannelType.GuildText) {
    throw new Error(
      `LAUNCHER_CHANNEL_ID ${channelId} is not a normal text channel. Slash commands and the "New event" button need a channel with a composer.`,
    );
  }

  return channel;
}
