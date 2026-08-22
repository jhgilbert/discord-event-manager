import { z } from 'zod';

/**
 * A Discord snowflake: 17-20 digits. Validating the shape here turns a
 * mistyped channel ID into a startup crash with a clear message, instead of a
 * confusing "Unknown Channel" hours later.
 */
const DiscordIdSchema = z
  .string({ error: (issue) => (issue.input === undefined ? 'is required' : 'must be text') })
  .trim()
  .regex(/^\d{17,20}$/, 'must be a Discord ID (17-20 digits, copied with Developer Mode on)');

const EnvironmentSchema = z.object({
  DISCORD_TOKEN: z
    .string({ error: (issue) => (issue.input === undefined ? 'is required' : 'must be text') })
    .trim()
    .min(1, 'is required'),
  DISCORD_GUILD_ID: DiscordIdSchema,
  EVENT_BUILDER_CHANNEL_ID: DiscordIdSchema,
  EVENTS_FORUM_CHANNEL_ID: DiscordIdSchema,
  DATABASE_PATH: z.string().trim().min(1).default('/data/events.db'),
  TZ: z.string().trim().min(1).default('UTC'),
  // Up to a week. 1440 is the day before, which is the common choice; the cap
  // exists only to catch someone typing minutes when they meant something else.
  REMINDER_LEAD_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_080, 'must be between 1 minute and 10080 (7 days)')
    .default(60),
});

export type Environment = z.infer<typeof EnvironmentSchema>;

function describeEnvironmentIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `  ${issue.path.join('.')} ${issue.message}`).join('\n');
}

export function loadEnvironment(): Environment {
  const result = EnvironmentSchema.safeParse(process.env);

  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${describeEnvironmentIssues(result.error)}`);
  }

  return result.data;
}
