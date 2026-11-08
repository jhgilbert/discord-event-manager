# Changelog

Notable changes to the bot, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Deploys no longer show the old container as "crashed".** Railway now
  starts the bot with `node` directly instead of through `npm start`, so the
  stop signal reaches the bot and it shuts down cleanly, closing the database
  properly on the way out.

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

[1.1.0]: https://github.com/jhgilbert/discord-event-manager/compare/c8137b5...v1.1.0
[1.0.0]: https://github.com/jhgilbert/discord-event-manager/commits/c8137b5
