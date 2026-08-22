# Discord event manager

A Discord bot that turns a modal submission into a forum post with RSVP buttons,
a live roster, plus-ones, capacity and a waitlist.

Hosts create events from a button in `#events-launcher`. The bot posts them to
the `#events` forum, keeps the roster current as people click, and promotes from
the waitlist whenever a seat frees up.

**Setup instructions are in [SETUP.md](./SETUP.md).** The design decisions and
their rationale are in [plans/events-bot-design.md](./plans/events-bot-design.md);
this file covers how the code is arranged.

---

## What it does

- **Create** — a five-field modal (title, date/time, description, location,
  capacity). Dates are free text: "Friday 7pm", "next Tuesday 18:30". The forum
  post is named `Board game night (Friday, Aug 7 at 6:30 PM)`, so the schedule
  is readable from the forum list without opening anything.
- **Host** — named on the panel in its own field, and RSVPed automatically when
  the event is created. They can still withdraw with *Can't make it*.
- **RSVP** — three buttons: *I'm in*, *I'm in +1*, *Can't make it*.
- **Capacity** — one number, total headcount. A guest takes a seat exactly as a
  member does, and so does the host.
- **Waitlist** — strict FIFO, promoted automatically when room appears, with an
  in-thread ping for whoever gets in.
- **Edit** — `/event edit` inside the post, host only.
- **Cancel** — `/event cancel` inside the post; notifies everyone, tags the post
  `Canceled`, locks the thread.
- **Delete** — `/event delete` inside the post, **server administrators only**.
  Erases the post, its replies and its RSVPs, after a confirmation naming what
  will be lost. Nobody is notified; use `cancel` for that.
- **Reminders** — posted in-thread to confirmed attendees, `REMINDER_LEAD_MINUTES`
  before the start (1440 = the day before). Events posted at shorter notice than
  the lead skip the reminder: the post is the notice.

## Stack

TypeScript on Node 24, discord.js 14, SQLite via better-sqlite3, Zod for
validation, chrono-node for date parsing. No web framework — the bot listens on
nothing and makes one outbound gateway connection.

## Layout

```
src/
  index.ts             entry point: client, startup sequence, shutdown
  context.ts           AppContext — the handful of things handlers need
  config/
    environment.ts     Zod schema over process.env
  db/
    schema.ts          DDL, idempotent, run on every boot
    database.ts        connection + pragmas
    event-queries.ts   \ one function per statement, no query building
    rsvp-queries.ts    /
  domain/              pure logic, no discord.js import anywhere
    types.ts           row shapes
    capacity.ts        seats taken / remaining
    rsvp-decision.ts   what a click means, given current state
    reconcile.ts       the promotion loop
    event-form.ts      Zod + chrono over the five modal fields
  discord/             rendering and API calls
    custom-ids.ts      versioned button and modal IDs
    event-modal.ts     the create/edit form
    event-panel.ts     the embed and buttons
    publish-event.ts   forum post creation
    refresh-event-panel.ts  re-render, unarchive, debounce
    forum-tags.ts      Open / Full / Canceled
    announcements.ts   in-thread pings
    launcher-panel.ts  the pinned "New event" message
    channels.ts        startup channel resolution
  handlers/            one file per interaction, plus a router
  commands/            slash command definition and registration
  jobs/
    reminder-job.ts    the once-a-minute sweep
```

The dependency direction is one-way: `domain/` imports nothing from `discord/`.
That is what lets the capacity and waitlist rules be exercised against a plain
SQLite file with no Discord client involved.

## The parts worth knowing before changing anything

**`reconcileEvent` is the only thing that promotes anyone.** It is called after
every mutation — RSVP, withdrawal, capacity edit. Handlers write their change
and call it; none of them contain promotion logic. This is why raising capacity
needs no special case: reconcile runs and simply finds more room.

**Every mutation runs inside `withMessageLock`.** Capacity check, write,
reconcile and re-render are one critical section per event. Without it, two
people clicking for the last seat both read `remaining = 1` and both get in.

**Upgrades are computed as a delta.** A confirmed solo member clicking "I'm in
+1" needs *one* more seat, not two. Recomputing from scratch is the easy bug
here, and it wrongly refuses people on an event with one seat left.

**Strict FIFO means seats are only ever granted by reconcile.** While a waitlist
exists, no click seats anyone directly — otherwise a newcomer could take the
seat the queue is waiting on. A queued member with a guest who is blocking a
single free seat unblocks by their own choice: they tap *I'm in*, drop the +1,
and reconcile seats them.

**The host's seat is written with the event row, in one transaction.**
`insertEventAndSeatHost` is the only way an event is created, so there is no
path that produces an event whose host is missing from its own roster. It is
also the one confirmed seat reconcile did not grant, which is harmless:
reconcile only ever adds people, and it recounts the roster every time.

**State lives in SQLite, never in the rendered message.** The panel is always
rebuilt from rows. Nothing is ever scraped back out of an embed.

**Custom IDs are versioned (`rsvp:v1:*`).** Discord stores them inside messages
that outlive any deploy. A semantic change to a button means adding `v2` and
keeping the `v1` handler, or every event posted before the deploy stops
responding.

## Local development

```bash
npm install
cp .env.example .env    # fill in, and set DATABASE_PATH=./data/events.db
npm run dev
```

`npm run dev` uses Node's built-in `--env-file` and `--watch`, so there is no
dotenv or ts-node dependency. Point it at a test server rather than the live
one — startup registers slash commands and posts a launcher panel.

```bash
npm run typecheck   # tsc --noEmit
npm run build       # tsc -> dist/
npm start           # node dist/index.js
```

## Operational notes

- **One replica, always.** SQLite allows one writer, and a second gateway
  connection would double-handle every click.
- **The database must live on the mounted volume.** See SETUP.md step 2.3.
- **`TZ` is load-bearing.** It decides what "Friday 7pm" means when a host types
  it, and it is the zone the date in a post's *name* is written in — a channel
  name is plain text, so `<t:unix:F>` cannot be used there. Everything inside a
  post does use that markup, and shows each viewer their own local time. This
  assumes a single-timezone group; a distributed one would want the date out of
  the name.
- **Reminders are at-most-once.** An event is marked as reminded *before* the
  message is sent, so a crash mid-send costs one missed reminder rather than a
  duplicate ping to everyone attending.
- **The reminder lead is read at sweep time, not stored per event.** Changing
  `REMINDER_LEAD_MINUTES` re-times every event that has not been reminded yet,
  which is why `events.created_at` exists: it is the only way to tell, later,
  whether an event was ever eligible for a reminder in the first place.
- **Logs are single-line JSON**, which is what Railway's log viewer indexes.

## Not built

Deferred in the design and still deferred here:

- Mirroring to native Discord Scheduled Events (the server's Events tab).
- Per-event guest limits above one.

## License

MIT — see [LICENSE](./LICENSE).
