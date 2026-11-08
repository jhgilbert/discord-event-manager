# Changelog

Notable changes to the bot, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-11-08

### Added

- **`/event plus-ones`** opens the +1 settings from inside the event's post,
  for a host who dismissed the reply with the **+1 settings** button. The host
  instructions in each new thread mention it.
- **RSVPing adds you to the event's thread,** so messages there reach you
  according to your own notification settings for it. Cancelling an RSVP does
  not remove you. `/event reload` adds everyone already on an open event.
- **The thread is told when +1s open.** When a host's "allowed on or after"
  date arrives, the bot posts a message (no pings) saying guests are now
  allowed.

### Changed

- **The +1 line is full-size.** "+1s are allowed on or after …" (and "This
  event was canceled." / "has ended.") moved from the post's small footer text
  into the body, still as the last line above the buttons.

### Fixed

- **Deploys no longer show the old container as "crashed".** Railway now
  starts the bot with `node` directly instead of through `npm start`, so the
  stop signal reaches the bot and it shuts down cleanly, closing the database
  properly on the way out.

### Upgrade notes

- Run `/event reload` once in each open event's post after deploying. That
  adds everyone already on the list to the thread; new RSVPs join it on their
  own.
- Existing posts pick up the full-size +1 line the next time they are redrawn
  (any click, or `/event reload`).
- Host instructions mentioning `/event plus-ones` appear only in threads for
  events created after the deploy.
- This deploy may still show the old container as "crashed" once, since that
  container was started the old way. Later deploys should not.

## [1.1.0] - 2026-11-08

### Added

- **+1 settings.** Hosts choose whether attendees can bring a guest: not
  allowed (the default for new events), or allowed on or after a date. The
  **RSVP +1** button stays greyed out until then, and the line above the
  buttons says why. Change it with **+1 settings**, offered after creating or
  editing an event. Turning +1s off keeps guests who are already on the list.
- **Reserved seats.** `/event reserve-seat for: Levi` holds a seat for someone
  who is not on Discord, and `/event release-seat for: Levi` gives it back (the
  name autocompletes). Host or server managers. A reserved seat counts and
  queues like any RSVP, so a full event puts Levi on the waitlist. Whoever
  reserved the seat is pinged on Levi's behalf.
- **Past events close themselves.** Once a day, events whose day is over have
  their buttons disabled and their post locked and closed, which moves it to
  the forum's *Older Posts*. No more deleting old events by hand.
- **`/event reload`** (administrators only) looks up everyone's current server
  nickname and redraws the post.
- **Host instructions.** A new event's first reply tells the host how to edit,
  cancel and reserve seats, and that those commands are only visible to them.

### Changed

- **Names instead of mentions on the post.** The Going list, waitlist and Host
  field show server nicknames as plain text. Mentions inside the post often
  showed as raw user numbers on mobile. Pings in the thread still use real
  mentions.
- **Button labels** are now **RSVP**, **RSVP +1** and **Cancel RSVP**, and the
  confirmation says "Your spot has been reserved." Buttons on existing posts
  keep working.
- **Background checks run less often.** Reminders are checked every 15 minutes
  (was every minute) and +1 dates hourly (was every minute).

### Upgrade notes

- The database upgrades itself on first start; no manual steps. Back up the
  volume first anyway.
- Events that existed before this version keep allowing +1s, as they did
  before. Only new events start with +1s off.
- Past events still in the forum are locked and closed by the first daily
  check after the deploy.
- No new Discord permissions or forum tags are needed.

## [1.0.0] - 2026-08-22

First release: events posted to a forum with RSVP buttons, capacity, a
waitlist, +1s, reminders, and `/event edit`, `cancel` and `delete`.

[1.2.0]: https://github.com/jhgilbert/discord-event-manager/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/jhgilbert/discord-event-manager/compare/c8137b5...v1.1.0
[1.0.0]: https://github.com/jhgilbert/discord-event-manager/commits/c8137b5
