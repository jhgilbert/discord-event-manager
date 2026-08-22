import {
  ChannelType,
  DiscordAPIError,
  RESTJSONErrorCodes,
  type Channel,
  type Client,
  type ForumChannel,
  type TextChannel,
} from 'discord.js';

function isChannelHiddenFromBot(error: unknown): boolean {
  return (
    error instanceof DiscordAPIError &&
    (error.code === RESTJSONErrorCodes.MissingAccess ||
      error.code === RESTJSONErrorCodes.UnknownChannel)
  );
}

/**
 * Discord hides a channel the bot cannot see rather than refusing it, so a
 * wrong ID and a private channel with no overwrite for the bot arrive as the
 * same error. Collapse both to null and let the caller name the variable.
 */
async function fetchChannelIfVisible(client: Client, channelId: string): Promise<Channel | null> {
  try {
    return await client.channels.fetch(channelId);
  } catch (error: unknown) {
    if (isChannelHiddenFromBot(error)) {
      return null;
    }

    throw error;
  }
}

function describeUnreachableChannel(variableName: string, channelId: string): string {
  return (
    `${variableName} ${channelId} could not be read. Either the ID is wrong, or the ` +
    `channel is private and the bot's role has no View Channel overwrite on it.`
  );
}

/**
 * Resolved once at startup rather than fetched per interaction: a mistyped or
 * wrong-type channel ID should stop the deploy, not fail silently on the first
 * click three hours later.
 */
export async function fetchForumChannel(client: Client, channelId: string): Promise<ForumChannel> {
  const channel = await fetchChannelIfVisible(client, channelId);

  if (channel === null) {
    throw new Error(describeUnreachableChannel('EVENTS_FORUM_CHANNEL_ID', channelId));
  }

  if (channel.type !== ChannelType.GuildForum) {
    throw new Error(
      `EVENTS_FORUM_CHANNEL_ID ${channelId} is not a forum channel. Events must be posted to a forum.`,
    );
  }

  return channel;
}

export async function fetchTextChannel(client: Client, channelId: string): Promise<TextChannel> {
  const channel = await fetchChannelIfVisible(client, channelId);

  if (channel === null) {
    throw new Error(describeUnreachableChannel('EVENT_BUILDER_CHANNEL_ID', channelId));
  }

  if (channel.type !== ChannelType.GuildText) {
    throw new Error(
      `EVENT_BUILDER_CHANNEL_ID ${channelId} is not a normal text channel. Slash commands and the "New event" button need a channel with a composer.`,
    );
  }

  return channel;
}
