# discord-event-manager

A Discord bot for one small server: events are posted to a forum channel with
RSVP buttons, capacity, a waitlist and +1s. TypeScript on Node 24, discord.js,
SQLite (better-sqlite3), hosted on Railway. SETUP.md covers first-time setup.

## Code

- ESM with `NodeNext`: relative imports end in `.js`, even from `.ts` files.
- Times are unix seconds, interpreted in the `TZ` environment variable
  (America/Chicago in production). Code that needs "midnight" or "today" uses
  the process clock, as `src/lib/start-of-day.ts` does.
- Layout: `domain/` holds the rules (capacity, waitlist,
  +1s, form parsing), `db/` is queries, `discord/` builds and
  sends what users see, `handlers/` respond to interactions, `jobs/` are the
  background sweeps.

## Verifying changes

- There is no test suite. Run `npm run typecheck` and `npm run build`, then
  exercise the compiled code in `dist/` with a small throwaway script.
- Test scheduled jobs (`src/jobs/`) with a fake clock (stub `Date` and
  `setTimeout`), including across a daylight-saving change. They use a
  chained `setTimeout` lined up with the clock (on the hour, or just after
  midnight) rather than `setInterval`, which keeps the time of day the bot
  booted at.

## Versioning

Versions follow [Semantic Versioning](https://semver.org). What counts as
what for this bot:

- **Patch** (1.3.1): fixes only. Nothing new for hosts or attendees to learn.
- **Minor** (1.4.0): anything new or different that people will notice, such
  as a new command, button, message or setting, as long as existing posts and
  commands keep working.
- **Major** (2.0.0): something that breaks existing posts or habits, such as
  old buttons that stop working, a removed or renamed command, or a database
  change that needs a manual step.

Hosting, dependency and security changes don't change the version level on
their own. They ride along with whatever else is in the release (a patch, if
they ship alone).

## Changelog

CHANGELOG.md follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

- Add entries under `## [Unreleased]` as changes are made, not at release
  time.
- Write for the server's members, not developers: what changed for them, with
  a bold lead-in sentence. Implementation details go in commit messages.
- Sections, in this order, only when used: Added, Changed, Fixed, Security,
  then **Upgrade notes** for anything to do after deploying (e.g. run
  `/event reload`, or "existing posts update on their next redraw").

## Releasing

1. In CHANGELOG.md, rename `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD`, start a
   new empty `[Unreleased]` above it, and update the compare links at the
   bottom.
2. `npm version X.Y.Z --no-git-tag-version`, then commit CHANGELOG.md,
   package.json and package-lock.json as "Release X.Y.Z".
3. Fast-forward `main` to the branch (`git merge --ff-only`). History has no
   merge commits.
4. `git tag -a vX.Y.Z -m "X.Y.Z"` (annotated).
5. `git push origin main vX.Y.Z`. **Pushing `main` deploys.** Only do this when
   asked.
6. Delete the feature branch once it's merged.

## Deploying (Railway)

- Railway deploys `main` on every push. Each deploy causes about a minute of
  downtime: the old container stops before the new one starts, because only
  one can use the SQLite database. Discord allows 1000 bot logins a day, so
  deploy frequency isn't a concern.
- Service settings live in `.railway/railway.ts`. `railway.json` is gone:
  Railway stops reading it on 2026-12-01. Always run `railway config plan`
  before `railway config apply`, and know that **`apply` redeploys the bot**.
- The `/data` volume holds the database (`DATABASE_PATH=/data/events.db`). It
  must stay declared and mounted in `.railway/railway.ts`, with its current
  size and region. If any of that is left out, `apply` detaches or changes it.
- Don't declare settings that equal Railway's defaults (such as the restart
  policy). Railway stores them as unset, so they show as a pending change on
  every plan.
- Back up the database before a release that changes its schema.
